#!/usr/bin/env python3
"""
Sorobits (`SBIT`) — Stellar-Heritage 32x32 Semantic Pixel-Art Studio & QA Engine.

Every layer, palette, frame, and chest emblem draws directly from Stellar history (2014-2026):
  - Chest Emblems (replacing generic boxes): Rocket2014, LumenRing, SorobanAbacus, QuorumDiamond, ZkPrism
  - Era I   (2014-15): Classic Rocket Logo, Lumen (XLM), Stroop Spark
  - Era II  (SCP/FBA): Quorum Slice nodes, 2-5s Ledger Heartbeat
  - Era III (2019+):   Orbital Ring rebrand, Strkey G/C heritage
  - Era IV  (S-Quest): Golden Soroban Abacus, Bee & Roscoe, Zebulon, FCA00C optics
  - Era V   (P20-P27): State Archival TTL Shield frames, ZK Poseidon2 Prism (Quantum Holo)
"""

from __future__ import annotations

import hashlib
import os
import sys
from dataclasses import dataclass
from typing import Dict, List, Sequence, Tuple

from PIL import Image, ImageDraw

GRID = 32


def rel_luminance(rgb: Tuple[int, int, int]) -> float:
    """Perceptual relative luminance Y in [0.0, 1.0]."""
    r, g, b = (c / 255.0 for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def rgb_hex(rgb: Tuple[int, int, int]) -> str:
    return f"#{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"


# 7 Lore Factions (strict hue-shifted ramps & perceptual luminance guarantees)
FACTIONS: Dict[str, Dict[int, Tuple[int, int, int]]] = {
    "Horizon Signal": {      # 2014 Genesis / Pioneer
        1: (23, 54, 128),
        2: (42, 98, 204),
        3: (108, 174, 245),
        4: (14, 28, 56),
        5: (38, 198, 245),
        6: (226, 250, 255),
        7: (11, 14, 34),
        8: (96, 114, 148),
        9: (224, 234, 248),
        10: (68, 78, 108),
        11: (198, 212, 236),
        12: (232, 62, 108),
        13: (255, 196, 214),
        14: (8, 11, 28),
        15: (19, 28, 64),
    },
    "Roscoe Violet": {       # Stellar Quest / FCA00C Launchers & OGs
        1: (62, 30, 124),
        2: (118, 60, 212),
        3: (184, 134, 252),
        4: (26, 14, 52),
        5: (246, 176, 52),
        6: (255, 246, 214),
        7: (18, 10, 36),
        8: (112, 92, 148),
        9: (234, 224, 252),
        10: (132, 92, 34),
        11: (248, 214, 126),
        12: (242, 98, 186),
        13: (255, 212, 244),
        14: (13, 8, 30),
        15: (32, 18, 66),
    },
    "Zebulon Crimson": {     # Sovereign Fire / Shout & Burn Phoenix
        1: (118, 28, 42),
        2: (206, 56, 62),
        3: (252, 138, 104),
        4: (38, 12, 20),
        5: (250, 196, 56),
        6: (255, 249, 218),
        7: (26, 10, 16),
        8: (146, 104, 88),
        9: (248, 232, 212),
        10: (148, 92, 28),
        11: (255, 216, 110),
        12: (255, 112, 42),
        13: (255, 232, 164),
        14: (20, 8, 16),
        15: (48, 16, 30),
    },
    "Soroswap Jade": {       # 2019 Orbital Ring / AMM Graduated
        1: (16, 84, 68),
        2: (30, 158, 118),
        3: (112, 234, 184),
        4: (10, 34, 30),
        5: (74, 242, 178),
        6: (224, 255, 242),
        7: (9, 22, 22),
        8: (84, 126, 122),
        9: (218, 246, 238),
        10: (134, 104, 38),
        11: (246, 218, 126),
        12: (56, 214, 236),
        13: (210, 252, 255),
        14: (7, 18, 20),
        15: (15, 42, 42),
    },
    "Abyssal Trench": {      # Deep Liquidity Whales
        1: (12, 68, 104),
        2: (22, 134, 182),
        3: (98, 212, 236),
        4: (8, 26, 44),
        5: (62, 228, 214),
        6: (222, 255, 252),
        7: (8, 16, 30),
        8: (76, 118, 144),
        9: (212, 240, 252),
        10: (116, 86, 42),
        11: (238, 196, 108),
        12: (94, 152, 255),
        13: (216, 238, 255),
        14: (6, 14, 28),
        15: (14, 34, 62),
    },
    "Golden Soroban": {      # Squaktahune Temple / Void Obsidian Stealth Gold
        1: (44, 42, 54),
        2: (82, 78, 96),
        3: (154, 144, 168),
        4: (18, 14, 24),
        5: (242, 182, 54),
        6: (255, 248, 214),
        7: (14, 12, 20),
        8: (94, 88, 108),
        9: (216, 208, 226),
        10: (136, 94, 30),
        11: (252, 212, 104),
        12: (58, 226, 246),
        13: (224, 254, 255),
        14: (26, 24, 40),
        15: (42, 38, 66),
    },
    "Poseidon Prism": {      # Protocol 25-27 ZK / Forge Quantum Holo
        1: (36, 48, 126),
        2: (68, 118, 216),
        3: (132, 236, 232),
        4: (22, 14, 48),
        5: (244, 92, 212),
        6: (240, 254, 255),
        7: (14, 10, 32),
        8: (108, 104, 162),
        9: (232, 242, 255),
        10: (64, 122, 144),
        11: (162, 248, 246),
        12: (64, 244, 198),
        13: (238, 255, 250),
        14: (12, 10, 34),
        15: (32, 24, 72),
    },
}


def audit_palette(name: str, pal: Dict[int, Tuple[int, int, int]]) -> List[str]:
    errs: List[str] = []
    if set(pal.keys()) != set(range(1, 16)):
        errs.append(f"{name}: palette must define slots 1..15")
        return errs
    lums = {i: rel_luminance(rgb) for i, rgb in pal.items()}
    for rname, idxs in [
        ("Suit", (1, 2, 3)),
        ("Visor", (4, 5, 6)),
        ("Helmet", (7, 8, 9)),
        ("Metal", (10, 11)),
        ("Relic", (12, 13)),
        ("Sky", (14, 15)),
    ]:
        for a, b in zip(idxs, idxs[1:]):
            if not (lums[a] < lums[b]):
                errs.append(f"{name}: {rname} L({a})={lums[a]:.3f} >= L({b})={lums[b]:.3f}")
            if lums[b] - lums[a] < 0.04:
                errs.append(f"{name}: {rname} ΔL({a},{b})={lums[b]-lums[a]:.3f} < 0.04")
    if lums[6] < 0.85:
        errs.append(f"{name}: visor specular L(6)={lums[6]:.3f} < 0.85")
    if lums[15] > 0.42:
        errs.append(f"{name}: sky accent L(15)={lums[15]:.3f} > 0.42")
    if pal[7] == (0, 0, 0):
        errs.append(f"{name}: pure #000000 outline forbidden")
    return errs


def parse_grid(rows: Sequence[str]) -> List[int]:
    if len(rows) != GRID:
        raise ValueError(f"Expected {GRID} rows, got {len(rows)}")
    buf: List[int] = []
    for r_i, row in enumerate(rows):
        if len(row) != GRID:
            raise ValueError(f"Row {r_i} length {len(row)} != {GRID}")
        for ch in row:
            buf.append(0 if ch == "." else int(ch, 16))
    return buf


# ---------------------------------------------------------------------------
# SUITS WITH MINIMALIST GEOMETRIC CHEST CORES (Square, Rectangle, Triangle, Circle, Diamond)
# Clean high-contrast 1-symbol geometry at 32x32 so every shape reads instantly at 32px!
# ---------------------------------------------------------------------------
SUITS: Dict[str, List[int]] = {
    # 1. Ledger Square Core (Clean square plate with 2x2 luminous core — Genesis Block)
    "LedgerSquare": parse_grid([
        *(["." * 32] * 20),
        "...........7777777777...........",  # 20
        "..........7BBBAAAAA557..........",  # 21 collar
        "........7773332222211777........",  # 22 shoulders
        ".......733B622222222B5117.......",  # 23 clasps
        "......73322277777777221117......",  # 24 square housing top
        "......73222274999947221117......",  # 25 clean silver trim top
        "......73222274566547221117......",  # 26 luminous 2x2 square core
        "......73222274555547221117......",  # 27
        "......73222277777777221117......",  # 28 square bottom
        ".......732222222221111117.......",  # 29
        ".......777777777777777777.......",  # 30
        "................................",  # 31
    ]),
    # 2. Telemetry Rectangle Bar (Wide horizontal ledger sync bar — Quest / FCA00C)
    "TelemetryRect": parse_grid([
        *(["." * 32] * 20),
        "...........7777777777...........",
        "..........7BBBBBAAAA57..........",
        "......77777333222221177777......",
        ".....7BB33B622222222B511AA7.....",
        ".....7332222222222222211117.....",
        ".....7322277777777777721117.....",  # wide crisp rectangle bar
        "......732276DDDD5544472117......",  # segmented progress glow inside rect
        "......73227777777777772117......",
        "......73222222222222221117......",
        ".......732222222221111117.......",
        ".......777777777777777777.......",
        "................................",
    ]),
    # 3. Rocket Delta Triangle (Sharp upward triangle — 2014 Rocket Ascent)
    "DeltaTriangle": parse_grid([
        *(["." * 32] * 20),
        "...........7777777777...........",
        "..........7BBBAAAAA557..........",
        "........7773332222211777........",
        ".......733B622222222B5117.......",
        "......73322222277222221117......",  # apex
        "......73222222765722221117......",  # 2px core
        "......73222227655572221117......",  # 4px slope
        "......73222275555557221117......",  # 6px triangle base
        "......73222277777777221117......",  # crisp flat bottom
        ".......732222222221111117.......",
        ".......777777777777777777.......",
        "................................",
    ]),
    # 4. Orbital Circle Core (Clean pixelated circle / Lumen Ring 2019)
    "OrbitalCircle": parse_grid([
        *(["." * 32] * 20),
        "...........7777777777...........",
        "..........7BBBAAAAA557..........",
        "........7773332222211777........",
        ".......733B622222222B5117.......",
        "......73322222777722221117......",  # top arc (4px)
        "......73222227655572221117......",  # circle upper curve
        "......7322222755D572221117......",  # circle center dot
        "......73222227555472221117......",  # circle lower curve
        "......73222222777722221117......",  # bottom arc (4px)
        ".......732222222221111117.......",
        ".......777777777777777777.......",
        "................................",
    ]),
    # 5. ZK Prism Diamond (Sleek minimalist 5x5 diamond core — Poseidon ZK / Stealth)
    "ZkDiamond": parse_grid([
        *(["." * 32] * 20),
        "...........7777777777...........",
        "..........788888888777..........",
        "........7773322222111777........",
        ".......733322222222211117.......",
        "......73322222277222221117......",  # top point
        "......73222222765722221117......",
        "......732222276DD572221117......",  # widest center
        "......73222222754722221117......",
        "......73222222277222221117......",  # bottom point
        ".......732222222221111117.......",
        ".......777777777777777777.......",
        "................................",
    ]),
}

HELMETS: Dict[str, List[int]] = {
    "ExplorerDome": parse_grid([
        *(["." * 32] * 6),
        "...........888888877............",
        ".........889999999887...........",
        "........89999999998887..........",
        "........89999998888887..........",
        ".......899999884444447..........",
        ".......8999987444444447.........",
        "......79965587444444447.........",
        "......78855587444444447.........",
        "......78855587444444447.........",
        ".......7789987444444447.........",
        "........799998777777777.........",
        "........79998888888887..........",
        ".........788888888887...........",
        "..........7777777777............",
        *(["." * 32] * 12),
    ]),
    "Vanguard": parse_grid([
        *(["." * 32] * 6),
        "..........8888888887............",
        ".........899999999887...........",
        "........89999888999887..........",
        "........89998888888887..........",
        ".......899987777777777..........",
        ".......8998744444444447.........",
        "......7BB65744444444447.........",
        "......7BA55744444444447.........",
        "......7AA54744444444447.........",
        ".......7788744444444447.........",
        "........79988777777777..........",
        "........788AAA8888887...........",
        ".........78888888887............",
        "..........7777777777............",
        *(["." * 32] * 12),
    ]),
    "CyborgHull": parse_grid([
        *(["." * 32] * 6),
        "...........888888877............",
        ".........8899999BBAA7...........",
        "........8999999BBA6A7...........",
        "........8999998BAA5A7...........",
        ".......89999884444447...........",
        ".......8999987444444447.........",
        "......79965587444444447.........",
        "......78855587444444447.........",
        "......78855587444444447.........",
        ".......7789987444444447.........",
        "........79999B777777777.........",
        "........79998BAAA8A8A7..........",
        ".........78888AAAAAA7...........",
        "..........7777777777............",
        *(["." * 32] * 12),
    ]),
    "VoidHood": parse_grid([
        *(["." * 32] * 5),
        "............888888..............",
        "..........8833332277............",
        ".........833322222217...........",
        "........83322222221117..........",
        "........83222777777717..........",
        ".......832227444444477..........",
        ".......8322744444444447.........",
        ".......8322744444444447.........",
        ".......8222744444444447.........",
        ".......7222744444444447.........",
        "........722744444444447.........",
        "........722277777777777.........",
        ".........722111111117...........",
        ".........711111111117...........",
        "..........7777777777............",
        *(["." * 32] * 12),
    ]),
}

VISORS: Dict[str, List[int]] = {
    "ClassicAstro": parse_grid([
        *(["." * 32] * 11),
        "..............66555555..........",
        "..............65555554..........",
        "..............55555444..........",
        "..............55444444..........",
        "..............44444444..........",
        *(["." * 32] * 16),
    ]),
    # FCA00C Twin-Lens 3D Anaglyph Optics (clean nose bridge!)
    "Fca00c3D": parse_grid([
        *(["." * 32] * 11),
        "..............777777777.........",
        "..............6C5776557.........",
        "..............CC5775547.........",
        "..............777777777.........",
        *(["." * 32] * 17),
    ]),
    # SCP Consensus Triple-Band HUD (clean, zero weird cheek dots!)
    "ScpLattice": parse_grid([
        *(["." * 32] * 11),
        "..............55555555..........",
        "..............66455466..........",
        "..............55455455..........",
        "..............44444444..........",
        "..............44444444..........",
        *(["." * 32] * 16),
    ]),
    # Deep Sonar Cyclops Bar
    "SonarSweep": parse_grid([
        *(["." * 32] * 11),
        "..............44444444..........",
        "..............56DDDD65..........",
        "..............44555544..........",
        "..............44444444..........",
        "..............44444444..........",
        *(["." * 32] * 16),
    ]),
    # Twin Photon Burn Laser (breaches right edge)
    "TwinLaser": parse_grid([
        *(["." * 32] * 11),
        "..............55555555..........",
        "..............6DCC5CDDCCCCCCCCD.",
        "..............44444444CCCCCCCCD.",
        "..............55555555..........",
        "..............44444444..........",
        *(["." * 32] * 16),
    ]),
}

RELICS: Dict[str, List[int]] = {
    "None": parse_grid(["." * 32 for _ in range(32)]),
    # 2014 First Ledger Beacon Antenna
    "LedgerAntenna": parse_grid([
        "................................",
        "........777.....................",
        ".......7CD7.....................",
        "........7A7.....................",
        "........787.....................",
        "........787.....................",
        "........787.....................",
        *(["." * 32] * 25),
    ]),
    # Sleek 2014 Retro Rocket Fin (replaces rounded lollipop look!)
    "RocketFin": parse_grid([
        "................................",
        "..............767...............",  # pointed nosecone + glint
        ".............79997..............",  # fuselage
        ".............79C97..............",  # red/accent band
        "............7B999B7.............",  # classic 2014 swept fins!
        "............7.7D7.7.............",  # clean thruster ignition
        "...............7................",
        *(["." * 32] * 25),
    ]),
    # Zebulon / Sovereign 3-Point Crown
    "SovereignCrown": parse_grid([
        "................................",
        "...........7.....7..............",
        "..........7D7.7.7D7.............",
        "..........7B77B77B7.............",
        "..........7BBBBBBB7.............",
        "..........7AA6BA6A7.............",
        "...........7777777..............",
        *(["." * 32] * 25),
    ]),
    # 2019 Tilted Orbital Halo Ring (balanced Saturn-style elliptical halo above crown)
    "OrbitalHalo": parse_grid([
        "................................",
        "...........7777777777...........",
        ".........776DDDDDDDD577.........",
        "........76D7777777777567........",
        ".........77..........77.........",
        "................................",
        *(["." * 32] * 26),
    ]),
    # Abyssal Hydro Crest
    "HydroFin": parse_grid([
        "................................",
        ".............777................",
        "............76D57...............",
        "...........7D55557..............",
        "..........755B4B557.............",
        "..........777777777.............",
        *(["." * 32] * 26),
    ]),
    # Golden Soroban Crown + ZK Prism Tip (Sharp Squaktahune Relic)
    "SorobanCrown": parse_grid([
        "................................",
        "..............7D7...............",  # glowing Poseidon prism tip
        ".............7D6D7..............",
        "............7BBBBB7.............",  # top abacus rail
        "...........7B6B4B6B7............",  # heaven gold beads
        "...........7AAAAAAA7............",
        "............7777777.............",
        *(["." * 32] * 25),
    ]),
    # Stroop Spark Orbital Companion (Clean floating orb in upper-right void)
    "StroopOrb": parse_grid([
        "................................",
        "................................",
        "................................",
        ".........................777....",
        "........................76DD7...",
        "........................75CC7...",
        ".........................777....",
        *(["." * 32] * 25),
    ]),
}

# Quorum Slice Aura: symmetric consensus nodes cleanly hovering beside helmet only (zero shoulder clash!)
AURAS: Dict[str, List[int]] = {
    "None": parse_grid(["." * 32 for _ in range(32)]),
    "QuorumSlice": parse_grid([
        *(["." * 32] * 8),
        ".....C....................C.....",
        "....55....................55....",
        *(["." * 32] * 10),
        ".....8....................8.....",
        *(["." * 32] * 11),
    ]),
    "WarpResonance": parse_grid([
        *(["." * 32] * 7),
        ".....55..................55.....",
        "....C5....................5C....",
        *(["." * 32] * 5),
        "....5......................5....",
        *(["." * 32] * 17),
    ]),
}


def make_frame(tier: str) -> List[int]:
    """Epigenetic TTL Shield Frames (max 1px perimeter + corner HUD brackets)."""
    buf = [0] * (GRID * GRID)
    if tier == "Clean":
        return buf

    def p(x: int, y: int, c: int) -> None:
        buf[y * GRID + x] = c

    if tier == "OriginHUD":
        for cx, cy, dx, dy in [(0, 0, 1, 1), (31, 0, -1, 1), (0, 31, 1, -1), (31, 31, -1, -1)]:
            p(cx, cy, 11)
            p(cx + dx, cy, 8)
            p(cx + 2 * dx, cy, 8)
            p(cx, cy + dy, 8)
            p(cx, cy + 2 * dy, 8)
    elif tier == "ArchivalBronze":
        for i in range(1, 31):
            p(i, 0, 10)
            p(i, 31, 10)
            p(0, i, 10)
            p(31, i, 10)
        for cx, cy in [(0, 0), (31, 0), (0, 31), (31, 31)]:
            p(cx, cy, 0)
        p(29, 1, 11)
        p(30, 1, 11)
        p(30, 2, 11)
    elif tier == "SovereignTTL":
        for i in range(1, 31):
            p(i, 0, 11)
            p(i, 31, 10)
            p(0, i, 11)
            p(31, i, 10)
        p(0, 0, 6)
        p(31, 0, 6)
        p(0, 31, 11)
        p(31, 31, 11)
        p(29, 1, 13)
        p(30, 2, 13)
        p(2, 1, 13)
        p(1, 2, 13)
    elif tier == "YardstickPrism":
        for i in range(1, 31):
            p(i, 0, 10)
            p(i, 31, 10)
            p(0, i, 10)
            p(31, i, 10)
        for cx, cy, dx, dy in [(0, 0, 1, 1), (31, 0, -1, 1), (0, 31, 1, -1), (31, 31, -1, -1)]:
            p(cx, cy, 6)
            p(cx + dx, cy, 13)
            p(cx + 2 * dx, cy, 5)
            p(cx, cy + dy, 13)
            p(cx, cy + 2 * dy, 5)
        p(1, 1, 13)
        p(30, 1, 13)
    else:
        raise ValueError(f"Unknown frame tier: {tier}")
    return buf


FRAMES = {t: make_frame(t) for t in ["Clean", "OriginHUD", "ArchivalBronze", "SovereignTTL", "YardstickPrism"]}


def procedural_sky(seed: bytes) -> List[int]:
    h = int.from_bytes(seed[:4], "little") or 0x9E3779B9
    buf = [14] * (GRID * GRID)

    def next_u32() -> int:
        nonlocal h
        h ^= (h << 13) & 0xFFFFFFFF
        h ^= (h >> 17) & 0xFFFFFFFF
        h ^= (h << 5) & 0xFFFFFFFF
        return h

    horizon_y = 12 + (next_u32() % 5)
    for y in range(horizon_y, horizon_y + 3):
        for x in range(GRID):
            if (x + y) % 2 == 0:
                buf[y * GRID + x] = 15
    for y in range(23, 27):
        for x in range(GRID):
            if (x + y) % 2 == 0:
                buf[y * GRID + x] = 15

    # Polar Navigation Star in top-left sky
    sx = 4 + (next_u32() % 2)
    sy = 4 + (next_u32() % 2)
    buf[(sy - 1) * GRID + sx] = 8
    buf[(sy + 1) * GRID + sx] = 8
    buf[sy * GRID + (sx - 1)] = 8
    buf[sy * GRID + (sx + 1)] = 8
    buf[sy * GRID + sx] = 9

    star_count = 4 + (next_u32() % 3)
    for _ in range(star_count):
        x = 2 + (next_u32() % 28)
        y = 2 + (next_u32() % 24)
        if 7 <= x <= 24 and 6 <= y <= 28:
            continue
        buf[y * GRID + x] = 8 if (next_u32() % 3) else 9
    return buf


@dataclass(frozen=True)
class SorobitSpec:
    name: str
    era_tag: str
    faction: str
    suit: str
    helmet: str
    visor: str
    relic: str
    aura: str
    frame: str
    seed_tag: str


GENESIS_8: List[SorobitSpec] = [
    SorobitSpec("AGQ01 Pioneer", "2014 Ledger-1", "Horizon Signal", "LedgerSquare", "ExplorerDome", "ClassicAstro", "LedgerAntenna", "None", "OriginHUD", "agq01-pioneer"),
    SorobitSpec("AGQ02 Launcher", "2014 Rocket", "Roscoe Violet", "DeltaTriangle", "Vanguard", "ClassicAstro", "RocketFin", "QuorumSlice", "ArchivalBronze", "agq02-launcher"),
    SorobitSpec("AGQ03 Shouter", "SCP Consensus", "Zebulon Crimson", "TelemetryRect", "ExplorerDome", "ScpLattice", "SovereignCrown", "QuorumSlice", "SovereignTTL", "agq03-shouter"),
    SorobitSpec("AGQ04 Graduate", "2019 Orbital", "Soroswap Jade", "OrbitalCircle", "ExplorerDome", "ClassicAstro", "OrbitalHalo", "QuorumSlice", "SovereignTTL", "agq04-graduate"),
    SorobitSpec("AGQ05 OG", "FCA00C Quest", "Roscoe Violet", "TelemetryRect", "CyborgHull", "Fca00c3D", "None", "None", "OriginHUD", "agq05-og"),
    SorobitSpec("AGQ06 Whale", "AMM Depth", "Abyssal Trench", "OrbitalCircle", "Vanguard", "SonarSweep", "HydroFin", "None", "SovereignTTL", "agq06-whale"),
    SorobitSpec("AGQ07 Phoenix", "Burn State", "Zebulon Crimson", "DeltaTriangle", "Vanguard", "TwinLaser", "StroopOrb", "None", "YardstickPrism", "agq07-phoenix"),
    SorobitSpec("AGQ08 Legend", "Golden Soroban", "Golden Soroban", "ZkDiamond", "CyborgHull", "Fca00c3D", "SorobanCrown", "WarpResonance", "YardstickPrism", "agq08-legend"),
]


def is_valid_combo(spec: SorobitSpec) -> Tuple[bool, str]:
    if spec.helmet == "VoidHood" and spec.relic in {"LedgerAntenna", "SovereignCrown", "SorobanCrown"}:
        return False, "VoidHood conflicts with protruding crest"
    if spec.visor == "TwinLaser" and spec.relic == "StroopOrb" and spec.aura == "WarpResonance":
        return False, "Keep top-right clear when TwinLaser + StroopOrb active"
    return True, "ok"


def compose_indices(spec: SorobitSpec) -> List[int]:
    seed = hashlib.sha256(spec.seed_tag.encode()).digest()
    canvas = procedural_sky(seed)
    for layer in [
        AURAS[spec.aura],
        SUITS[spec.suit],
        HELMETS[spec.helmet],
        VISORS[spec.visor],
        RELICS[spec.relic],
        FRAMES[spec.frame],
    ]:
        for i, val in enumerate(layer):
            if val != 0:
                canvas[i] = val
    return canvas


def to_svg_paths(indices: List[int], pal: Dict[int, Tuple[int, int, int]]) -> Tuple[str, int, int]:
    paths: Dict[int, List[str]] = {}
    for y in range(GRID):
        row = indices[y * GRID : (y + 1) * GRID]
        x = 0
        while x < GRID:
            c = row[x]
            w = 1
            while x + w < GRID and row[x + w] == c:
                w += 1
            if c != 14:
                paths.setdefault(c, []).append(f"M{x} {y}h{w}v1h-{w}z")
            x += w
    bg_hex = rgb_hex(pal[14])
    body = [f"<rect width='32' height='32' fill='{bg_hex}'/>"]
    for c in sorted(paths.keys()):
        body.append(f"<path fill='{rgb_hex(pal[c])}' d='{''.join(paths[c])}'/>")
    svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' shape-rendering='crispEdges'>" + "".join(body) + "</svg>"
    return svg, len(paths) + 1, len(svg)


def render_pil(indices: List[int], pal: Dict[int, Tuple[int, int, int]], scale: int = 1) -> Image.Image:
    im = Image.new("RGB", (GRID, GRID))
    im.putdata([pal[c] for c in indices])
    if scale > 1:
        im = im.resize((GRID * scale, GRID * scale), Image.Resampling.NEAREST)
    return im


def count_orphan_pixels(layer: List[int]) -> int:
    orphans = 0
    for y in range(GRID):
        for x in range(GRID):
            if layer[y * GRID + x] == 0:
                continue
            if not any(
                0 <= x + dx < GRID and 0 <= y + dy < GRID and layer[(y + dy) * GRID + (x + dx)] != 0
                for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]
            ):
                orphans += 1
    return orphans


def monte_carlo_sim(samples: int = 100_000) -> Dict[str, int]:
    keys = [list(d.keys()) for d in (FACTIONS, SUITS, HELMETS, VISORS, RELICS, AURAS, FRAMES)]
    rejected = 0
    for i in range(samples):
        d = hashlib.sha256(i.to_bytes(8, "little")).digest()
        sp = SorobitSpec(
            name=f"SBIT-{i}",
            era_tag="P26",
            faction=keys[0][d[0] % len(keys[0])],
            suit=keys[1][d[1] % len(keys[1])],
            helmet=keys[2][d[2] % len(keys[2])],
            visor=keys[3][d[3] % len(keys[3])],
            relic=keys[4][d[4] % len(keys[4])],
            aura=keys[5][d[5] % len(keys[5])],
            frame=keys[6][d[6] % len(keys[6])],
            seed_tag=str(i),
        )
        ok, _ = is_valid_combo(sp)
        if not ok:
            rejected += 1
    return {"samples": samples, "rejected": rejected}


def encode_rle(grid: List[int]) -> bytes:
    """Encodes a 32x32 grid into deterministic (len: u8, val: u8) RLE pairs."""
    out = bytearray()
    cur = grid[0]
    cnt = 1
    for px in grid[1:]:
        if px == cur and cnt < 255:
            cnt += 1
        else:
            out.append(cnt)
            out.append(cur)
            cur = px
            cnt = 1
    out.append(cnt)
    out.append(cur)
    return bytes(out)


def decode_rle(data: bytes) -> List[int]:
    out: List[int] = []
    for i in range(0, len(data), 2):
        out.extend([data[i + 1]] * data[i])
    return out


def format_rust_bytes(name: str, data: bytes) -> str:
    hex_items = [f"0x{b:02X}" for b in data]
    lines = []
    for i in range(0, len(hex_items), 16):
        lines.append("    " + ", ".join(hex_items[i : i + 16]) + ",")
    return f"pub const {name}: &[u8] = &[\n" + "\n".join(lines) + "\n];"


def emit_rust_assets(rust_path: str) -> None:
    """Compiles audited Season-1 palettes and modular RLE layers into Rust source."""
    sections: List[str] = [
        "//! Auto-generated by `scripts/sorobits_studio.py --emit-rust`. Do not edit manually.",
        "//!",
        "//! Season-1 Genesis & Modular 32x32 Semantic Layers (RLE `(len, slot)` pairs) and",
        "//! 7 Stellar-heritage Faction Palettes (15 RGB triplets = 45 bytes each).",
        "#![allow(dead_code)]",
        "",
        "pub const FACTION_COUNT: usize = 7;",
        "pub const SUIT_COUNT: usize = 5;",
        "pub const HELMET_COUNT: usize = 4;",
        "pub const VISOR_COUNT: usize = 5;",
        "pub const RELIC_COUNT: usize = 8;",
        "pub const AURA_COUNT: usize = 3;",
        "",
        "#[derive(Copy, Clone)]",
        "pub struct GenesisTemplate {",
        "    pub code: &'static str,",
        "    pub title: &'static str,",
        "    pub era: &'static str,",
        "    pub faction: u8,",
        "    pub suit: u8,",
        "    pub helmet: u8,",
        "    pub visor: u8,",
        "    pub relic: u8,",
        "    pub aura: u8,",
        "    pub frame: u8,",
        "}",
        "",
        "pub const FACTION_NAMES: [&str; FACTION_COUNT] = [",
    ]
    for fname in FACTIONS.keys():
        sections.append(f'    "{fname}",')
    sections.append("];\n")

    sections.append("pub const FACTION_PALETTES: [[u8; 45]; FACTION_COUNT] = [")
    for fname, fpal in FACTIONS.items():
        flat: List[int] = []
        for slot in range(1, 16):
            flat.extend(fpal[slot])
        items = ", ".join(f"0x{b:02X}" for b in flat)
        sections.append(f"    // {fname}")
        sections.append(f"    [{items}],")
    sections.append("];\n")

    total_rle_bytes = 0
    for cat_upper, layer_dict in [
        ("SUIT", SUITS),
        ("HELMET", HELMETS),
        ("VISOR", VISORS),
        ("RELIC", RELICS),
        ("AURA", AURAS),
    ]:
        sections.append(f'pub const {cat_upper}_NAMES: [&str; {len(layer_dict)}] = [')
        for lname in layer_dict.keys():
            sections.append(f'    "{lname}",')
        sections.append("];")

        rle_const_names = []
        for idx, (lname, grid) in enumerate(layer_dict.items()):
            rle = encode_rle(grid)
            assert decode_rle(rle) == grid, f"RLE roundtrip failed for {cat_upper}.{lname}"
            total_rle_bytes += len(rle)
            cname = f"{cat_upper}_{idx}_{lname.upper()}"
            rle_const_names.append(cname)
            sections.append(format_rust_bytes(cname, rle))

        sections.append(f"pub const {cat_upper}_LAYERS: [&[u8]; {len(layer_dict)}] = [")
        for cname in rle_const_names:
            sections.append(f"    {cname},")
        sections.append("];\n")

    frame_map = {"Clean": 0, "OriginHUD": 1, "ArchivalBronze": 2, "SovereignTTL": 3, "YardstickPrism": 4}
    faction_list = list(FACTIONS.keys())
    suit_list = list(SUITS.keys())
    helmet_list = list(HELMETS.keys())
    visor_list = list(VISORS.keys())
    relic_list = list(RELICS.keys())
    aura_list = list(AURAS.keys())

    sections.append("pub const GENESIS_TEMPLATES: [GenesisTemplate; 8] = [")
    for idx, sp in enumerate(GENESIS_8, start=1):
        code = f"AGQ0{idx}"
        title = sp.name.split(" ", 1)[1]
        sections.append(
            f'    GenesisTemplate {{ code: "{code}", title: "{title}", era: "{sp.era_tag}", '
            f"faction: {faction_list.index(sp.faction)}, suit: {suit_list.index(sp.suit)}, "
            f"helmet: {helmet_list.index(sp.helmet)}, visor: {visor_list.index(sp.visor)}, "
            f"relic: {relic_list.index(sp.relic)}, aura: {aura_list.index(sp.aura)}, "
            f"frame: {frame_map[sp.frame]} }},"
        )
    sections.append("];\n")

    os.makedirs(os.path.dirname(rust_path), exist_ok=True)
    with open(rust_path, "w", encoding="utf-8") as f:
        f.write("\n".join(sections))
    print(f"RUST ASSETS GENERATED: {rust_path} (total RLE across 25 modular layers = {total_rle_bytes} bytes)")


def main() -> int:
    if len(sys.argv) >= 2 and sys.argv[1] == "--emit-telegram":
        errs = [e for fname, fpal in FACTIONS.items() for e in audit_palette(fname, fpal)]
        if errs:
            print("PALETTE AUDIT FAILED:\n" + "\n".join(errs))
            return 1
        out_dir = sys.argv[2] if len(sys.argv) >= 3 else "frontend/public/telegram"
        os.makedirs(out_dir, exist_ok=True)
        from PIL import ImageFont

        def font(sz: int):
            for p in [
                "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
                "/System/Library/Fonts/Menlo.ttc",
                "/System/Library/Fonts/Monaco.ttf",
            ]:
                if os.path.exists(p):
                    try:
                        return ImageFont.truetype(p, sz)
                    except Exception:
                        pass
            return ImageFont.load_default()

        def draw_starfield(im: Image.Image) -> None:
            d = ImageDraw.Draw(im)
            rng_seed = 0x50520B17
            for _ in range(42):
                rng_seed = (1664525 * rng_seed + 1013904223) & 0xFFFFFFFF
                x = rng_seed % im.width
                rng_seed = (1664525 * rng_seed + 1013904223) & 0xFFFFFFFF
                y = rng_seed % im.height
                c = (58, 92, 148) if (rng_seed & 1) else (130, 178, 240)
                d.rectangle([x, y, x + 2, y + 2], fill=c)

        # 1. astrogate-bot-banner.png (1200x630)
        b = Image.new("RGB", (1200, 630), (8, 11, 28))
        draw_starfield(b)
        bd = ImageDraw.Draw(b)
        hero = render_pil(compose_indices(GENESIS_8[0]), FACTIONS[GENESIS_8[0].faction], scale=11)  # 352x352
        bd.rectangle([48, 126, 412, 490], outline=(56, 189, 248), width=3)
        b.paste(hero, (54, 132))
        bd.rectangle([460, 52, 1152, 578], fill=(10, 15, 36), outline=(56, 189, 248), width=2)
        bd.text((494, 78), "SEASON 1  ·  100% ON-CHAIN SOROBITS (SBIT)", fill=(250, 204, 21), font=font(20))
        bd.text((494, 112), "ASTROGATΞ", fill=(248, 250, 252), font=font(56))
        bd.text((494, 178), "Fair Launchpad · Soroswap AMM · Sorobits NFTs", fill=(125, 211, 252), font=font(23))
        for idx, sp in enumerate(GENESIS_8):
            col, row = idx % 4, idx // 4
            tx = 496 + col * 158
            ty = 228 + row * 124
            sprite = render_pil(compose_indices(sp), FACTIONS[sp.faction], scale=3)  # 96x96
            bd.rectangle([tx - 3, ty - 3, tx + 99, ty + 99], outline=(51, 65, 85), width=2)
            b.paste(sprite, (tx, ty))
        bd.text((494, 496), "AGQ01–AGQ08 · Native 32x32 SVG on Stellar Soroban", fill=(110, 231, 183), font=font(21))
        bd.text((494, 530), "Built by NunaLabs · Open Inside Telegram Mini App", fill=(148, 163, 184), font=font(19))
        banner_path = os.path.join(out_dir, "astrogate-bot-banner.png")
        b.save(banner_path)
        print(f"TELEGRAM BANNER SAVED: {banner_path} ({b.size[0]}x{b.size[1]})")

        # 2. sorobits-hero-card.png (1200x630)
        s = Image.new("RGB", (1200, 630), (9, 10, 26))
        draw_starfield(s)
        sd = ImageDraw.Draw(s)
        sd.rectangle([36, 36, 1164, 594], fill=(12, 14, 34), outline=(99, 102, 241), width=2)
        sd.text((70, 64), "STELLAR SOROBAN · SEP-50 · ZERO IPFS / ZERO PINATA", fill=(165, 180, 252), font=font(20))
        sd.text((70, 98), "SOROBITS (SBIT)", fill=(248, 250, 252), font=font(54))
        sd.text((70, 164), "32x32 Genomic Pixel Art · Season 1 Sealed On-Chain", fill=(103, 232, 249), font=font(24))
        for idx, sp in enumerate(GENESIS_8):
            col, row = idx % 4, idx // 4
            tx = 72 + col * 270
            ty = 214 + row * 156
            sprite = render_pil(compose_indices(sp), FACTIONS[sp.faction], scale=4)  # 128x128
            sd.rectangle([tx - 3, ty - 3, tx + 131, ty + 131], outline=(71, 85, 105), width=2)
            s.paste(sprite, (tx, ty))
            sd.text((tx + 140, ty + 24), sp.name.split(" ")[0], fill=(250, 204, 21), font=font(20))
            sd.text((tx + 140, ty + 52), sp.name.split(" ", 1)[1], fill=(241, 245, 249), font=font(18))
            sd.text((tx + 140, ty + 80), sp.era_tag, fill=(148, 163, 184), font=font(15))
        sd.text((70, 544), "Built by NunaLabs · Inspect Live in Telegram Mini App", fill=(110, 231, 183), font=font(20))
        hero_path = os.path.join(out_dir, "sorobits-hero-card.png")
        s.save(hero_path)
        print(f"SOROBITS HERO CARD SAVED: {hero_path} ({s.size[0]}x{s.size[1]})")

        # 3. market-hero-card.png (1200x630)
        m = Image.new("RGB", (1200, 630), (8, 12, 26))
        draw_starfield(m)
        md = ImageDraw.Draw(m)
        md.rectangle([36, 36, 1164, 594], fill=(11, 16, 36), outline=(56, 189, 248), width=2)
        md.text((70, 64), "FAIR-FLYWHEEL v4.3  ·  SOROSWAP DEX  ·  LIVE FEED", fill=(125, 211, 252), font=font(20))
        md.text((70, 98), "CURVE & KING ARENA", fill=(248, 250, 252), font=font(50))
        md.text((70, 162), "0.80% Flat Buys · 100% LP Burned · Burn-to-Chat Shouts", fill=(250, 204, 21), font=font(22))
        market_picks = [GENESIS_8[1], GENESIS_8[2], GENESIS_8[5], GENESIS_8[6]]
        for idx, sp in enumerate(market_picks):
            tx = 72 + idx * 270
            ty = 224
            sprite = render_pil(compose_indices(sp), FACTIONS[sp.faction], scale=6)  # 192x192
            md.rectangle([tx - 3, ty - 3, tx + 195, ty + 195], outline=(56, 189, 248), width=2)
            m.paste(sprite, (tx, ty))
            md.text((tx, ty + 206), sp.name, fill=(248, 250, 252), font=font(20))
            md.text((tx, ty + 234), sp.era_tag, fill=(148, 163, 184), font=font(17))
        md.text((70, 540), "Built by NunaLabs · Real-Time Stellar Soroban Telemetry", fill=(110, 231, 183), font=font(20))
        m_path = os.path.join(out_dir, "market-hero-card.png")
        m.save(m_path)
        print(f"MARKET HERO CARD SAVED: {m_path} ({m.size[0]}x{m.size[1]})")

        # 4. wallet-quests-card.png (1200x630)
        w = Image.new("RGB", (1200, 630), (10, 10, 24))
        draw_starfield(w)
        wd = ImageDraw.Draw(w)
        wd.rectangle([36, 36, 1164, 594], fill=(14, 14, 34), outline=(16, 185, 129), width=2)
        wd.text((70, 64), "SELF-CUSTODY VAULT  ·  CLOUDSTORAGE  ·  SEASON 1", fill=(110, 231, 183), font=font(20))
        wd.text((70, 98), "PILOT VAULT & QUESTS", fill=(248, 250, 252), font=font(50))
        wd.text((70, 162), "Encrypted PIN Vault + Earn On-Chain Sorobits Chat Ranks", fill=(196, 181, 253), font=font(22))
        vault_picks = [GENESIS_8[0], GENESIS_8[3], GENESIS_8[4], GENESIS_8[7]]
        for idx, sp in enumerate(vault_picks):
            tx = 72 + idx * 270
            ty = 224
            sprite = render_pil(compose_indices(sp), FACTIONS[sp.faction], scale=6)  # 192x192
            wd.rectangle([tx - 3, ty - 3, tx + 195, ty + 195], outline=(16, 185, 129), width=2)
            w.paste(sprite, (tx, ty))
            wd.text((tx, ty + 206), sp.name, fill=(248, 250, 252), font=font(20))
            wd.text((tx, ty + 234), sp.era_tag, fill=(148, 163, 184), font=font(17))
        wd.text((70, 540), "Built by NunaLabs · Unlock Ranks, Sprint Boosts & VIP Alpha", fill=(250, 204, 21), font=font(20))
        w_path = os.path.join(out_dir, "wallet-quests-card.png")
        w.save(w_path)
        print(f"WALLET QUESTS CARD SAVED: {w_path} ({w.size[0]}x{w.size[1]})")

        # 5. community-hero-card.png (1200x630)
        cm = Image.new("RGB", (1200, 630), (7, 13, 30))
        draw_starfield(cm)
        cmd = ImageDraw.Draw(cm)
        cmd.rectangle([36, 36, 1164, 594], fill=(10, 18, 40), outline=(56, 189, 248), width=2)
        cmd.text((70, 64), "OFFICIAL HANGOUT  ·  STELLAR SOROBAN  ·  NUNALABS", fill=(125, 211, 252), font=font(20))
        cmd.text((70, 98), "ASTROGATΞ COMMUNITY", fill=(248, 250, 252), font=font(50))
        cmd.text((70, 162), "Human Chat · Live $TICKER Lookups · Zero Trade Spam", fill=(250, 204, 21), font=font(22))
        comm_cards = [
            (GENESIS_8[0], "1-TAP MINI APP", "CloudStorage Vault", (56, 189, 248)),
            (GENESIS_8[1], "FAIR LAUNCHPAD", "7 XLM · 100% LP Burn", (167, 139, 250)),
            (GENESIS_8[3], "SOROBITS NFTs", "100% On-Chain SVG", (52, 211, 153)),
            (GENESIS_8[7], "SMART BOT", "/market · /king · /ask", (250, 204, 21)),
        ]
        for idx, (sp, label, sub, border_rgb) in enumerate(comm_cards):
            tx = 72 + idx * 270
            ty = 224
            sprite = render_pil(compose_indices(sp), FACTIONS[sp.faction], scale=6)  # 192x192
            cmd.rectangle([tx - 3, ty - 3, tx + 195, ty + 195], outline=border_rgb, width=2)
            cm.paste(sprite, (tx, ty))
            cmd.text((tx, ty + 206), label, fill=border_rgb, font=font(20))
            cmd.text((tx, ty + 234), sub, fill=(203, 213, 225), font=font(17))
        cmd.text((70, 540), "Built by NunaLabs · Paste CA… / GA… / $TICKER or tap Mini App", fill=(110, 231, 183), font=font(20))
        cm_path = os.path.join(out_dir, "community-hero-card.png")
        cm.save(cm_path)
        print(f"COMMUNITY HERO CARD SAVED: {cm_path} ({cm.size[0]}x{cm.size[1]})")

        # 6. feed-hero-card.png (1200x630)
        fd = Image.new("RGB", (1200, 630), (6, 16, 22))
        draw_starfield(fd)
        fdd = ImageDraw.Draw(fd)
        fdd.rectangle([36, 36, 1164, 594], fill=(8, 22, 30), outline=(16, 185, 129), width=2)
        fdd.text((70, 64), "24/7 ON-CHAIN TELEMETRY  ·  ANTI-DUST FILTERED  ·  STELLAR", fill=(110, 231, 183), font=font(20))
        fdd.text((70, 98), "ASTROGATΞ LIVE FEED", fill=(248, 250, 252), font=font(50))
        fdd.text((70, 162), "Launches · >=2 XLM Trades · 80%+ Push · Graduations · Burns", fill=(52, 211, 153), font=font(22))
        feed_cards = [
            (GENESIS_8[1], "FAIR LAUNCHES", "New v4.3 Tokens", (56, 189, 248)),
            (GENESIS_8[5], "WHALE & PUSH", ">=2 XLM & >=80%", (16, 185, 129)),
            (GENESIS_8[3], "DEX GRADUATE", "100% LP Burned", (250, 204, 21)),
            (GENESIS_8[2], "KING & SHOUTS", "Burn-to-Chat + SBIT", (251, 113, 133)),
        ]
        for idx, (sp, label, sub, border_rgb) in enumerate(feed_cards):
            tx = 72 + idx * 270
            ty = 224
            sprite = render_pil(compose_indices(sp), FACTIONS[sp.faction], scale=6)  # 192x192
            fdd.rectangle([tx - 3, ty - 3, tx + 195, ty + 195], outline=border_rgb, width=2)
            fd.paste(sprite, (tx, ty))
            fdd.text((tx, ty + 206), label, fill=border_rgb, font=font(20))
            fdd.text((tx, ty + 234), sub, fill=(203, 213, 225), font=font(17))
        fdd.text((70, 540), "Built by NunaLabs · Pure Alerts Channel · Chat in @AstroGateCommunity", fill=(125, 211, 252), font=font(20))
        fd_path = os.path.join(out_dir, "feed-hero-card.png")
        fd.save(fd_path)
        print(f"FEED HERO CARD SAVED: {fd_path} ({fd.size[0]}x{fd.size[1]})")

        # 7-9. Circular-safe 512x512 chat avatars (distinct color rings + badges)
        def make_circle_avatar(
            bg_rgb: tuple[int, int, int],
            ring_rgb: tuple[int, int, int],
            glow_rgb: tuple[int, int, int],
            badge_text: str,
            badge_bg: tuple[int, int, int],
            badge_fg: tuple[int, int, int],
            sprite_spec: GenesisSpec,
            is_rocket: bool = False,
            out_name: str = "avatar.png",
        ) -> None:
            av = Image.new("RGB", (512, 512), bg_rgb)
            ad = ImageDraw.Draw(av)
            # Subtle radial backdrop & orbital rings strictly inside circular crop (r <= 238)
            ad.ellipse([18, 18, 494, 494], outline=glow_rgb, width=10)
            ad.ellipse([30, 30, 482, 482], outline=ring_rgb, width=6)
            if is_rocket:
                # Crisp scaled-up pixel rocket + radar ring centered inside safe circle
                ad.ellipse([104, 72, 408, 376], outline=(12, 92, 74), width=4)
                px = 24
                ox, oy = 256 - 6 * px, 98
                rocket_pixels = [
                    (5, 0, (244, 63, 94)), (6, 0, (244, 63, 94)),
                    (4, 1, (226, 232, 240)), (5, 1, (248, 250, 252)), (6, 1, (248, 250, 252)), (7, 1, (203, 213, 225)),
                    (4, 2, (226, 232, 240)), (5, 2, (56, 189, 248)), (6, 2, (16, 185, 129)), (7, 2, (203, 213, 225)),
                    (4, 3, (226, 232, 240)), (5, 3, (248, 250, 252)), (6, 3, (248, 250, 252)), (7, 3, (203, 213, 225)),
                    (3, 4, (56, 189, 248)), (4, 4, (226, 232, 240)), (5, 4, (248, 250, 252)), (6, 4, (248, 250, 252)), (7, 4, (203, 213, 225)), (8, 4, (14, 165, 233)),
                    (2, 5, (56, 189, 248)), (3, 5, (56, 189, 248)), (4, 5, (226, 232, 240)), (5, 5, (248, 250, 252)), (6, 5, (248, 250, 252)), (7, 5, (203, 213, 225)), (8, 5, (14, 165, 233)), (9, 5, (14, 165, 233)),
                    (2, 6, (14, 165, 233)), (3, 6, (56, 189, 248)), (4, 6, (226, 232, 240)), (5, 6, (248, 250, 252)), (6, 6, (248, 250, 252)), (7, 6, (203, 213, 225)), (8, 6, (14, 165, 233)), (9, 6, (2, 132, 199)),
                    (4, 7, (250, 204, 21)), (5, 7, (251, 146, 60)), (6, 7, (251, 146, 60)), (7, 7, (250, 204, 21)),
                    (5, 8, (249, 115, 22)), (6, 8, (244, 63, 94)),
                    (5, 9, (244, 63, 94)), (6, 9, (244, 63, 94)),
                ]
                for gx, gy, col in rocket_pixels:
                    ad.rectangle([ox + gx * px, oy + gy * px, ox + (gx + 1) * px - 1, oy + (gy + 1) * px - 1], fill=col)
                # Live radar dot top-right inside circle
                ad.ellipse([336, 96, 382, 142], fill=(16, 185, 129), outline=(236, 253, 245), width=4)
            else:
                sp_img = render_pil(compose_indices(sprite_spec), FACTIONS[sprite_spec.faction], scale=8)  # 256x256
                av.paste(sp_img, (128, 86))

            # Bold pill badge safely inside bottom arc of circle
            pill_w, pill_h = 196, 56
            px0 = (512 - pill_w) // 2
            py0 = 374
            ad.rounded_rectangle([px0, py0, px0 + pill_w, py0 + pill_h], radius=24, fill=badge_bg, outline=ring_rgb, width=3)
            bf = font(30)
            bbox = ad.textbbox((0, 0), badge_text, font=bf)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            ad.text(((512 - tw) // 2, py0 + (pill_h - th) // 2 - 4), badge_text, fill=badge_fg, font=bf)
            out_p = os.path.join(out_dir, out_name)
            av.save(out_p)
            print(f"AVATAR SAVED: {out_p} (512x512)")

        make_circle_avatar(
            bg_rgb=(7, 14, 34),
            ring_rgb=(56, 189, 248),
            glow_rgb=(14, 60, 110),
            badge_text="APP",
            badge_bg=(10, 28, 62),
            badge_fg=(224, 242, 254),
            sprite_spec=GENESIS_8[0],
            out_name="astrogate-bot-avatar.png",
        )
        make_circle_avatar(
            bg_rgb=(15, 9, 36),
            ring_rgb=(167, 139, 250),
            glow_rgb=(65, 32, 120),
            badge_text="CHAT",
            badge_bg=(38, 20, 82),
            badge_fg=(243, 232, 255),
            sprite_spec=GENESIS_8[7],
            out_name="astrogate-community-avatar.png",
        )
        make_circle_avatar(
            bg_rgb=(5, 22, 24),
            ring_rgb=(16, 185, 129),
            glow_rgb=(10, 78, 64),
            badge_text="LIVE",
            badge_bg=(8, 48, 42),
            badge_fg=(209, 250, 229),
            sprite_spec=GENESIS_8[3],
            is_rocket=True,
            out_name="astrogate-feed-avatar.png",
        )
        return 0

    if len(sys.argv) >= 2 and sys.argv[1] == "--emit-pngs":
        errs = [e for fname, fpal in FACTIONS.items() for e in audit_palette(fname, fpal)]
        if errs:
            print("PALETTE AUDIT FAILED:\n" + "\n".join(errs))
            return 1
        out_dir = sys.argv[2] if len(sys.argv) >= 3 else "frontend/public/badges"
        os.makedirs(out_dir, exist_ok=True)
        slugs = ["pioneer", "launcher", "shouter", "graduate", "og", "whale", "phoenix", "legend"]
        for slug, sp in zip(slugs, GENESIS_8):
            comp = compose_indices(sp)
            im = render_pil(comp, FACTIONS[sp.faction], scale=16)  # 32x16 = 512x512 crisp
            dest = os.path.join(out_dir, f"{slug}.png")
            im.save(dest)
            print(f"PNG SAVED: {dest} ({im.size[0]}x{im.size[1]})")
        return 0

    if len(sys.argv) >= 2 and sys.argv[1] == "--emit-rust":
        errs = [e for fname, fpal in FACTIONS.items() for e in audit_palette(fname, fpal)]
        if errs:
            print("PALETTE AUDIT FAILED:\n" + "\n".join(errs))
            return 1
        out_rust = sys.argv[2] if len(sys.argv) >= 3 else "contracts/sorobits/src/assets.rs"
        emit_rust_assets(out_rust)
        return 0

    out_dir = sys.argv[1] if len(sys.argv) > 1 else "./sorobits_output"
    os.makedirs(out_dir, exist_ok=True)

    errs = [e for fname, fpal in FACTIONS.items() for e in audit_palette(fname, fpal)]
    if errs:
        print("PALETTE AUDIT FAILED:\n" + "\n".join(errs))
        return 1
    print(f"PALETTE AUDIT PASSED ({len(FACTIONS)} Stellar-lore factions).")

    for cat, lmap in [("SUITS", SUITS), ("HELMETS", HELMETS), ("VISORS", VISORS), ("RELICS", RELICS)]:
        for lname, lbuf in lmap.items():
            orph = count_orphan_pixels(lbuf)
            if orph:
                print(f"WARNING {cat}.{lname}: {orph} orphan pixel(s)")

    tile, pad = 160, 16
    sheet = Image.new("RGB", (4 * tile + 5 * pad, 2 * (tile + 34) + 3 * pad), (10, 12, 22))
    draw = ImageDraw.Draw(sheet)

    print("\nGENESIS 8 (STELLAR-HERITAGE REDESIGN):")
    for idx, sp in enumerate(GENESIS_8):
        ok, msg = is_valid_combo(sp)
        assert ok, f"Invalid {sp.name}: {msg}"
        comp = compose_indices(sp)
        pal = FACTIONS[sp.faction]
        _, pnodes, sbytes = to_svg_paths(comp, pal)
        neg = sum(1 for v in comp if v in (14, 15)) / (GRID * GRID) * 100.0
        print(f"  {sp.name:15s} | {sp.era_tag:14s} | {sp.suit:15s} | {pnodes:2d}p | {sbytes:4d}B | neg={neg:4.1f}%")
        col, row = idx % 4, idx // 4
        x0 = pad + col * (tile + pad)
        y0 = pad + row * (tile + 34 + pad)
        sheet.paste(render_pil(comp, pal, scale=5), (x0, y0))
        draw.text((x0 + 2, y0 + tile + 4), f"{sp.name}\n{sp.era_tag} · {sp.suit}", fill=(220, 232, 250))

    sheet_path = os.path.join(out_dir, "sorobits_genesis_stellar_v2.png")
    sheet.save(sheet_path)

    # Chest Emblems Zoom Comparison (all 5 suits on ExplorerDome + Horizon Signal vs Golden Soroban)
    ctile = 160
    csheet = Image.new("RGB", (5 * ctile + 6 * 12, ctile + 48), (12, 14, 24))
    cdraw = ImageDraw.Draw(csheet)
    for i, sname in enumerate(SUITS.keys()):
        sp = SorobitSpec(sname, "Chest Core", "Golden Soroban" if sname == "ZkDiamond" else ("Soroswap Jade" if sname == "OrbitalCircle" else "Horizon Signal"), sname, "ExplorerDome", "ClassicAstro", "None", "None", "OriginHUD", f"chest-{sname}")
        comp = compose_indices(sp)
        pal = FACTIONS[sp.faction]
        x0 = 12 + i * (ctile + 12)
        csheet.paste(render_pil(comp, pal, scale=5), (x0, 12))
        cdraw.text((x0 + 4, ctile + 18), sname, fill=(225, 236, 252))
    chest_path = os.path.join(out_dir, "sorobits_chest_emblems.png")
    csheet.save(chest_path)

    mc = monte_carlo_sim(100_000)
    print(f"\nMONTE CARLO ({mc['samples']}): rejected={mc['rejected']} ({mc['rejected']/mc['samples']*100:.2f}%)")
    print(f"Saved:\n  {sheet_path}\n  {chest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
