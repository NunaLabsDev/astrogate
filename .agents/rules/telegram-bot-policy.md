---
trigger: glob
globs: "frontend/worker/**, frontend/functions/**, scripts/*telegram*, frontend/scripts/*telegram*"
---

# AstroGate Telegram Bot & Mini App Policy

1. **100% English Strictly**:
   - Every user-facing string, command reply, inline button label, bot profile description, menu button, and feed alert for `@AstroGateSorobanBot`, `@AstroGateCommunity`, and `@AstroGateFeed` (groups, channels, and DMs) **must be strictly in English** (`lang = 'en'`).
2. **Internal Telegram Links Only**:
   - **Never** send external web URLs (`https://astrogate.pages.dev/...`) inside Telegram messages or inline buttons.
   - Always use internal Telegram deep links (`https://t.me/AstroGateSorobanBot?start=...`) so Mini App launches via `web_app` preserve `Telegram.WebApp.CloudStorage` wallet state intact.
3. **Channel Isolation (`@AstroGateFeed` vs `@AstroGateCommunity`)**:
   - Automated on-chain event broadcasts (`routeLaunchpadEventTargets`) must go **only** to `@AstroGateFeed` (`community: false` across all event kinds).
   - `@AstroGateCommunity` responds strictly to interactive commands, `$TICKER` lookups, and immediate secret-seed (`S...`) leak deletion.
4. **Auth, Service Binding & Fail-Closed Secret Guards**:
   - Preserve `ASTROW` Service Binding routing (`frontend/functions/` -> `astrogate-stellar` Worker).
   - Keep constant-time SHA-256 verification on `X-Telegram-Bot-Api-Secret-Token`, HMAC-SHA256 `X-Telegram-Init-Data` checks on `/api/telegram/{session,pulse}` and `/api/v1/wallet/{link,vault}`, and fail-closed rejection of any Stellar `S...` secret seeds.
