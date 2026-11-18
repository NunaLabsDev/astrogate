#!/usr/bin/env python3
"""
MTProto User-API provisioning tool for AstroGate Telegram ecosystem.

Creates clean production chats from scratch, migrates @AstroGateFeed (to a true
Broadcast Channel) and @AstroGateCommunity (to a Forum Supergroup with Topics),
promotes @AstroGateSorobanBot with exact admin permissions, creates a shareable
folder (t.me/addlist/...), and outputs Bot-API -100... chat IDs.

Credentials & session stay strictly outside git in ~/.secrets/astrogate/:
  - ~/.secrets/astrogate/telegram-mtproto.env  (TG_API_ID, TG_API_HASH, TG_PHONE)
  - ~/.secrets/astrogate/telegram-user.session (Telethon user session, chmod 600)
"""

from __future__ import annotations

import argparse
import asyncio
import datetime
import json
import os
import random
import stat
import sys
from pathlib import Path
from typing import Any

from telethon import TelegramClient, errors, functions, types

SECRETS_DIR = Path.home() / ".secrets" / "astrogate"
ENV_FILE = SECRETS_DIR / "telegram-mtproto.env"
SESSION_FILE = SECRETS_DIR / "telegram-user.session"
RESULT_FILE = SECRETS_DIR / "telegram-chats.json"

REPO_ROOT = Path(__file__).resolve().parent.parent
TELEGRAM_ASSETS = REPO_ROOT / "frontend" / "public" / "telegram"
FEED_AVATAR = TELEGRAM_ASSETS / "astrogate-feed-avatar.png"
COMMUNITY_AVATAR = TELEGRAM_ASSETS / "astrogate-community-avatar.png"

BOT_USERNAME = "AstroGateSorobanBot"
FEED_USERNAME = "AstroGateFeed"
COMMUNITY_USERNAME = "AstroGateCommunity"

FEED_TITLE = "AstroGate Live Feed 📡 · NunaLabs"
FEED_ABOUT = (
    "Real-time Stellar Soroban alerts: Fair-Flywheel v4.3 launches, swaps, "
    "Soroswap graduations, buyback burns, Burn-to-Chat shouts & Sorobits NFTs. "
    "Chat: @AstroGateCommunity · App: @AstroGateSorobanBot"
)

COMMUNITY_TITLE = "AstroGate Community 🌊🚀 · NunaLabs"
COMMUNITY_ABOUT = (
    "AstroGate Community — Fair-Flywheel v4.3 Launchpad + Soroswap AMM + "
    "Sorobits (SBIT) On-Chain NFTs on Stellar Soroban. "
    "Live Feed: @AstroGateFeed · App: @AstroGateSorobanBot"
)

FORUM_TOPICS = [
    ("Alpha & Trading", 7322096),
    ("Token Launches & Shouts", 16766590),
    ("Sorobits & Quests", 13338331),
    ("Support & Feedback", 9367192),
]


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def bot_api_chat_id(channel_id: int) -> str:
    return f"-100{channel_id}"


def ensure_private_perms(path: Path) -> None:
    if path.exists():
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


def get_credentials() -> tuple[int, str, str | None]:
    load_env_file(ENV_FILE)
    api_id_raw = os.environ.get("TG_API_ID", "").strip()
    api_hash = os.environ.get("TG_API_HASH", "").strip()
    phone = os.environ.get("TG_PHONE", "").strip() or None
    if not api_id_raw.isdigit() or not api_hash:
        print(
            f"Missing TG_API_ID / TG_API_HASH.\n"
            f"1. Visit https://my.telegram.org -> API development tools\n"
            f"2. Save them in {ENV_FILE} (outside git):\n"
            f"   TG_API_ID=12345678\n"
            f"   TG_API_HASH=your_32_char_hash\n"
            f"   TG_PHONE=+34600000000\n",
            file=sys.stderr,
        )
        sys.exit(1)
    return int(api_id_raw), api_hash, phone


async def resolve_entity_safe(client: TelegramClient, ref: str) -> Any | None:
    try:
        return await client.get_entity(ref)
    except Exception:
        return None


async def cmd_inspect(client: TelegramClient) -> None:
    me = await client.get_me()
    print(f"Authenticated user: {me.first_name} (@{me.username}, id={me.id})")
    for uname in [BOT_USERNAME, COMMUNITY_USERNAME, FEED_USERNAME]:
        ent = await resolve_entity_safe(client, uname)
        if not ent:
            print(f"  @{uname}: NOT FOUND")
            continue
        if isinstance(ent, types.User):
            print(f"  @{uname}: User/Bot id={ent.id}")
        elif isinstance(ent, types.Channel):
            kind = "Channel (broadcast)" if ent.broadcast else "Supergroup"
            print(
                f"  @{uname}: {kind} id={ent.id} bot_api_id={bot_api_chat_id(ent.id)} "
                f"forum={bool(ent.forum)} title={ent.title!r}"
            )

    filters_res = await client(functions.messages.GetDialogFiltersRequest())
    filters = getattr(filters_res, "filters", [])
    print(f"Existing chat folders ({len(filters)}):")
    for flt in filters:
        if isinstance(flt, (types.DialogFilter, types.DialogFilterChatlist)):
            title = getattr(flt.title, "text", flt.title)
            print(f"  id={flt.id} title={title!r} type={type(flt).__name__}")


async def move_username_safely(
    client: TelegramClient,
    old_entity: Any | None,
    new_channel: types.Channel,
    username: str,
) -> None:
    new_input = await client.get_input_entity(new_channel)
    if old_entity and isinstance(old_entity, types.Channel) and old_entity.id != new_channel.id:
        old_input = await client.get_input_entity(old_entity)
        print(f"Releasing @{username} from old chat {old_entity.id}...")
        await client(functions.channels.UpdateUsernameRequest(channel=old_input, username=""))
        await asyncio.sleep(0.5)
    print(f"Assigning @{username} to new chat {new_channel.id}...")
    await client(functions.channels.UpdateUsernameRequest(channel=new_input, username=username))


async def set_channel_avatar(client: TelegramClient, channel: types.Channel, img_path: Path) -> None:
    if not img_path.exists():
        print(f"Skipping missing avatar: {img_path}")
        return
    uploaded = await client.upload_file(str(img_path))
    inp = await client.get_input_entity(channel)
    await client(
        functions.channels.EditPhotoRequest(
            channel=inp,
            photo=types.InputChatUploadedPhoto(file=uploaded),
        )
    )


async def create_shareable_folder(
    client: TelegramClient,
    feed_channel: types.Channel,
    community_group: types.Channel,
    bot_user: types.User,
) -> str | None:
    filters_res = await client(functions.messages.GetDialogFiltersRequest())
    existing = getattr(filters_res, "filters", [])
    used_ids = {getattr(f, "id", 0) for f in existing}
    folder_id = 2
    while folder_id in used_ids:
        folder_id += 1

    feed_peer = await client.get_input_entity(feed_channel)
    comm_peer = await client.get_input_entity(community_group)
    bot_peer = await client.get_input_entity(bot_user)

    # First include all 3 in a shareable folder; if Telegram restricts bot peers
    # inside chatlists, fall back to [community, feed] for the public addlist link.
    for peers_label, peers in [
        ("Community + Feed + Bot", [comm_peer, feed_peer, bot_peer]),
        ("Community + Feed", [comm_peer, feed_peer]),
    ]:
        try:
            chatlist_filter = types.DialogFilterChatlist(
                id=folder_id,
                title=types.TextWithEntities(text="AstroGate 🌊", entities=[]),
                pinned_peers=[],
                include_peers=peers,
                has_my_invites=True,
                emoticon="🌊",
            )
            await client(
                functions.messages.UpdateDialogFilterRequest(
                    id=folder_id,
                    filter=chatlist_filter,
                )
            )
            exported = await client(
                functions.chatlists.ExportChatlistInviteRequest(
                    chatlist=types.InputChatlistDialogFilter(filter_id=folder_id),
                    title="AstroGate 🌊",
                    peers=peers,
                )
            )
            url = exported.invite.url
            print(f"✓ Created shareable folder ({peers_label}): {url}")
            return url
        except errors.RPCError as exc:
            print(f"Note: folder attempt ({peers_label}) returned {type(exc).__name__}: {exc}")
    return None


async def cmd_provision(client: TelegramClient, dry_run: bool) -> None:
    me = await client.get_me()
    print(f"Provisioning as {me.first_name} (@{me.username}, id={me.id})")

    bot_user = await resolve_entity_safe(client, BOT_USERNAME)
    if not isinstance(bot_user, types.User):
        raise RuntimeError(f"Could not resolve bot @{BOT_USERNAME}")

    old_feed = await resolve_entity_safe(client, FEED_USERNAME)
    old_comm = await resolve_entity_safe(client, COMMUNITY_USERNAME)

    print("Current state:")
    print(
        f"  @{FEED_USERNAME}:",
        f"id={old_feed.id} broadcast={getattr(old_feed, 'broadcast', None)}"
        if old_feed
        else "None",
    )
    print(
        f"  @{COMMUNITY_USERNAME}:",
        f"id={old_comm.id} megagroup={getattr(old_comm, 'megagroup', None)} forum={getattr(old_comm, 'forum', None)}"
        if old_comm
        else "None",
    )

    if dry_run:
        print("\n[DRY RUN] Would create:")
        print(f"  1. New Broadcast Channel -> @{FEED_USERNAME} ({FEED_TITLE})")
        print(f"  2. New Forum Supergroup  -> @{COMMUNITY_USERNAME} ({COMMUNITY_TITLE}) + 4 Topics")
        print(f"  3. Promote @{BOT_USERNAME} as admin in both")
        print(f"  4. Create shareable Chat Folder (t.me/addlist/...)")
        return

    # 1. Create clean Broadcast Channel for @AstroGateFeed
    print("\n1/6 Creating clean Broadcast Channel for Live Feed...")
    feed_updates = await client(
        functions.channels.CreateChannelRequest(
            title=FEED_TITLE,
            about=FEED_ABOUT,
            broadcast=True,
        )
    )
    feed_channel = feed_updates.chats[0]
    feed_input = await client.get_input_entity(feed_channel)
    await set_channel_avatar(client, feed_channel, FEED_AVATAR)
    await move_username_safely(client, old_feed, feed_channel, FEED_USERNAME)

    # Ensure NO discussion group is linked so Feed never forwards into Community
    try:
        await client(
            functions.channels.SetDiscussionGroupRequest(
                broadcast=feed_input,
                group=types.InputChannelEmpty(),
            )
        )
    except errors.RPCError:
        pass

    # Promote bot in Feed Channel
    await client(
        functions.channels.EditAdminRequest(
            channel=feed_input,
            user_id=await client.get_input_entity(bot_user),
            admin_rights=types.ChatAdminRights(
                post_messages=True,
                edit_messages=True,
                delete_messages=True,
                pin_messages=True,
                other=True,
            ),
            rank="Live Feed Bot",
        )
    )
    print(f"✓ Feed Channel ready: id={feed_channel.id} (Bot API {bot_api_chat_id(feed_channel.id)})")

    # 2. Create clean Forum Supergroup for @AstroGateCommunity
    print("\n2/6 Creating clean Forum Supergroup for Community...")
    comm_updates = await client(
        functions.channels.CreateChannelRequest(
            title=COMMUNITY_TITLE,
            about=COMMUNITY_ABOUT,
            megagroup=True,
            forum=True,
        )
    )
    comm_group = comm_updates.chats[0]
    comm_input = await client.get_input_entity(comm_group)

    # Keep chat history visible to new members & enforce clean member permissions
    try:
        await client(
            functions.channels.TogglePreHistoryHiddenRequest(
                channel=comm_input,
                enabled=False,
            )
        )
    except errors.RPCError as exc:
        print(f"Note: TogglePreHistoryHidden skipped: {exc}")

    await client(
        functions.messages.EditChatDefaultBannedRightsRequest(
            peer=comm_input,
            banned_rights=types.ChatBannedRights(
                until_date=datetime.datetime.fromtimestamp(0, tz=datetime.timezone.utc),
                send_polls=True,
                change_info=True,
                invite_users=True,
                pin_messages=True,
                manage_topics=True,
            ),
        )
    )

    await set_channel_avatar(client, comm_group, COMMUNITY_AVATAR)
    await move_username_safely(client, old_comm, comm_group, COMMUNITY_USERNAME)

    # Promote bot in Community Forum Supergroup
    await client(
        functions.channels.EditAdminRequest(
            channel=comm_input,
            user_id=await client.get_input_entity(bot_user),
            admin_rights=types.ChatAdminRights(
                delete_messages=True,
                ban_users=True,
                invite_users=True,
                pin_messages=True,
                manage_topics=True,
                other=True,
            ),
            rank="AstroGate Bot",
        )
    )
    print(
        f"✓ Community Forum ready: id={comm_group.id} (Bot API {bot_api_chat_id(comm_group.id)})"
    )

    # 3. Create 4 organized Forum Topics
    print("\n3/6 Creating Community Forum Topics...")
    topic_ids: dict[str, int] = {}
    for title, color in FORUM_TOPICS:
        try:
            res = await client(
                functions.messages.CreateForumTopicRequest(
                    peer=comm_input,
                    title=title,
                    icon_color=color,
                    random_id=random.randint(1, 2**62),
                )
            )
            msg_id = next(
                (
                    u.message.id
                    for u in getattr(res, "updates", [])
                    if hasattr(u, "message") and hasattr(u.message, "id")
                ),
                0,
            )
            topic_ids[title] = msg_id
            print(f"  ✓ Topic '{title}' (thread_id={msg_id})")
        except errors.RPCError as exc:
            print(f"  ! Failed creating topic '{title}': {exc}")

    # 4. Create shareable Chat Folder (t.me/addlist/...)
    print("\n4/6 Creating shareable AstroGate Chat Folder...")
    folder_url = await create_shareable_folder(client, feed_channel, comm_group, bot_user)

    # Notify members in legacy chats with clean 1-tap links to the new chats
    for label, old_ent in [("legacy Community", old_comm), ("legacy Feed", old_feed)]:
        if old_ent and isinstance(old_ent, types.Channel):
            try:
                notice = (
                    "🌊🚀 **AstroGate has upgraded to brand-new, clean chats!**\n\n"
                    f"• 💬 **New Community Forum (Topics + AI Copilot):** @{COMMUNITY_USERNAME}\n"
                    f"• 📡 **New Live Alerts Channel:** @{FEED_USERNAME}\n"
                    f"• 🤖 **Mini App & Bot:** @{BOT_USERNAME}\n"
                    + (f"• 📁 **Join All Chats in 1 Tap:** {folder_url}\n" if folder_url else "")
                )
                msg = await client.send_message(old_ent, notice, link_preview=False)
                await client.pin_message(old_ent, msg, notify=False)
                print(f"✓ Posted & pinned migration notice in {label} ({old_ent.id})")
            except errors.RPCError as exc:
                print(f"Note: could not post migration notice in {label}: {exc}")

    # 5. Save provisioning receipt outside git
    SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    receipt = {
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "feed": {
            "username": f"@{FEED_USERNAME}",
            "mtproto_id": feed_channel.id,
            "bot_api_chat_id": bot_api_chat_id(feed_channel.id),
            "old_mtproto_id": getattr(old_feed, "id", None),
        },
        "community": {
            "username": f"@{COMMUNITY_USERNAME}",
            "mtproto_id": comm_group.id,
            "bot_api_chat_id": bot_api_chat_id(comm_group.id),
            "old_mtproto_id": getattr(old_comm, "id", None),
            "topics": topic_ids,
        },
        "folder_url": folder_url,
    }
    RESULT_FILE.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    ensure_private_perms(RESULT_FILE)

    print("\n5/6 Saved provisioning receipt:", RESULT_FILE)
    print(json.dumps(receipt, indent=2))
    print(
        "\n6/6 Next: update frontend/wrangler.jsonc with the new Bot API IDs + folder_url,\n"
        "run frontend/scripts/setup-telegram-chats.mjs --post-pins, and deploy worker!"
    )


async def cmd_upgrade_community(client: TelegramClient) -> None:
    """
    Restores @AstroGateCommunity onto the original 114-member supergroup (1625368092),
    removes today's test/migration noise while keeping real human messages intact,
    enables Forum Topics, creates the 4 Topics, deletes the temp empty supergroup
    (4495130036), and updates the shareable folder to point to Community (1625368092)
    + new Broadcast Feed Channel (3912502880) + @AstroGateSorobanBot.
    """
    bot_user = await resolve_entity_safe(client, BOT_USERNAME)
    if not isinstance(bot_user, types.User):
        raise RuntimeError(f"Could not resolve bot @{BOT_USERNAME}")

    orig_comm = await client.get_entity(1625368092)
    orig_input = await client.get_input_entity(orig_comm)
    feed_channel = await client.get_entity(3912502880)
    temp_comm = await resolve_entity_safe(client, 4495130036)

    # 1. Remove only today's test/migration noise in original Community (preserve human chat)
    noise_ids = [17653, 17652, 17651, 17650, 17649, 17638]
    try:
        await client.delete_messages(orig_comm, noise_ids)
        print(f"✓ Cleaned {len(noise_ids)} test/migration messages in Community 1625368092")
    except errors.RPCError as exc:
        print(f"Note: delete_messages skipped: {exc}")

    # 2. Move @AstroGateCommunity back to 1625368092 if not already there
    if getattr(orig_comm, "username", None) != COMMUNITY_USERNAME:
        await move_username_safely(client, temp_comm, orig_comm, COMMUNITY_USERNAME)
    if temp_comm and isinstance(temp_comm, types.Channel) and temp_comm.id != orig_comm.id:
        try:
            await client(functions.channels.DeleteChannelRequest(channel=await client.get_input_entity(temp_comm)))
            print(f"✓ Deleted empty temporary supergroup {temp_comm.id}")
        except errors.RPCError as exc:
            print(f"Note: DeleteChannelRequest on temp {temp_comm.id}: {exc}")

    # 3. Enable Forum Topics + clean member permissions + full bot admin rights on 1625368092
    if not getattr(orig_comm, "forum", False):
        try:
            await client(functions.channels.ToggleForumRequest(channel=orig_input, enabled=True, tabs=True))
            print("✓ Enabled Forum Topics on Community 1625368092")
        except errors.RPCError as exc:
            print(f"Note: ToggleForumRequest: {exc}")

    try:
        await client(
            functions.messages.EditChatDefaultBannedRightsRequest(
                peer=orig_input,
                banned_rights=types.ChatBannedRights(
                    until_date=datetime.datetime.fromtimestamp(0, tz=datetime.timezone.utc),
                    send_polls=True,
                    change_info=True,
                    invite_users=True,
                    pin_messages=True,
                    manage_topics=True,
                ),
            )
        )
    except errors.RPCError as exc:
        print(f"Note: EditChatDefaultBannedRightsRequest: {exc}")

    try:
        await client(
            functions.channels.EditAdminRequest(
                channel=orig_input,
                user_id=await client.get_input_entity(bot_user),
                admin_rights=types.ChatAdminRights(
                    delete_messages=True,
                    ban_users=True,
                    invite_users=True,
                    pin_messages=True,
                    manage_topics=True,
                    other=True,
                ),
                rank="AstroGate Bot",
            )
        )
        print("✓ Promoted @AstroGateSorobanBot with full moderation & topic rights on 1625368092")
    except errors.FreshChangeAdminsForbiddenError:
        print(
            "Note: Telegram restricts changing admin rights on newly logged-in sessions for ~24h; "
            "@AstroGateSorobanBot is already admin on 1625368092 (enable Ban Users & Manage Topics in Group Settings -> Administrators)."
        )
    except errors.RPCError as exc:
        print(f"Note: EditAdminRequest skipped: {exc}")

    # 4. Create the 4 Forum Topics (avoiding duplicates if already present)
    existing_topics: set[str] = set()
    try:
        topics_res = await client(
            functions.messages.GetForumTopicsRequest(
                peer=orig_input,
                offset_date=None,
                offset_id=0,
                offset_topic=0,
                limit=50,
            )
        )
        for t in getattr(topics_res, "topics", []):
            if hasattr(t, "title"):
                existing_topics.add(t.title)
    except errors.RPCError:
        pass

    topic_ids: dict[str, int] = {}
    for title, color in FORUM_TOPICS:
        if title in existing_topics:
            print(f"  · Topic already exists: '{title}'")
            continue
        try:
            res = await client(
                functions.messages.CreateForumTopicRequest(
                    peer=orig_input,
                    title=title,
                    icon_color=color,
                    random_id=random.randint(1, 2**62),
                )
            )
            msg_id = next(
                (
                    u.message.id
                    for u in getattr(res, "updates", [])
                    if hasattr(u, "message") and hasattr(u.message, "id")
                ),
                0,
            )
            topic_ids[title] = msg_id
            print(f"  ✓ Created Topic '{title}' (thread_id={msg_id})")
        except errors.RPCError as exc:
            print(f"  ! Failed creating topic '{title}': {exc}")

    # 5. Remove old broken AstroGate folder if present and create updated shareable folder
    filters_res = await client(functions.messages.GetDialogFiltersRequest())
    for flt in getattr(filters_res, "filters", []):
        if isinstance(flt, types.DialogFilterChatlist):
            t = getattr(flt.title, "text", flt.title)
            if t == "AstroGate 🌊":
                try:
                    await client(functions.messages.UpdateDialogFilterRequest(id=flt.id, filter=None))
                    print(f"✓ Removed previous AstroGate folder id={flt.id}")
                except errors.RPCError:
                    pass

    folder_url = await create_shareable_folder(client, feed_channel, orig_comm, bot_user)

    receipt = {
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "feed": {
            "username": f"@{FEED_USERNAME}",
            "mtproto_id": feed_channel.id,
            "bot_api_chat_id": bot_api_chat_id(feed_channel.id),
            "type": "channel",
        },
        "community": {
            "username": f"@{COMMUNITY_USERNAME}",
            "mtproto_id": orig_comm.id,
            "bot_api_chat_id": bot_api_chat_id(orig_comm.id),
            "type": "forum_supergroup",
            "topics": topic_ids,
        },
        "folder_url": folder_url,
    }
    RESULT_FILE.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    ensure_private_perms(RESULT_FILE)
    print("\nSaved receipt:", RESULT_FILE)
    print(json.dumps(receipt, indent=2))


async def async_main() -> None:
    parser = argparse.ArgumentParser(description="AstroGate MTProto Telegram Provisioner")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--login", action="store_true", help="Authenticate and save user session")
    mode.add_argument("--inspect", action="store_true", help="Read-only inspection of current chats")
    mode.add_argument("--provision", action="store_true", help="Create fresh Feed + Community chats")
    mode.add_argument(
        "--upgrade-community",
        action="store_true",
        help="Keep 114-member Community (1625368092), clean noise, enable Topics, keep new Feed channel",
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview --provision without mutating")
    args = parser.parse_args()

    SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    api_id, api_hash, phone = get_credentials()

    client = TelegramClient(str(SESSION_FILE), api_id, api_hash)
    if args.login:
        await client.start(phone=phone)
        ensure_private_perms(SESSION_FILE)
        me = await client.get_me()
        print(f"✓ Session saved securely at {SESSION_FILE} for {me.first_name} (@{me.username})")
        await client.disconnect()
        return

    await client.connect()
    if not await client.is_user_authorized():
        print(
            "MTProto session not authorized yet. Run:\n"
            "  python3 scripts/telegram_mtproto_provision.py --login",
            file=sys.stderr,
        )
        await client.disconnect()
        sys.exit(1)

    try:
        if args.inspect:
            await cmd_inspect(client)
        elif args.provision:
            await cmd_provision(client, dry_run=args.dry_run)
        elif args.upgrade_community:
            await cmd_upgrade_community(client)
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(async_main())
