//! `no_std` Genomic 32x32 Raster Compositor & Per-Color SVG `<path>` Renderer.

use soroban_sdk::{contracttype, Bytes, BytesN, Env, String};

use crate::assets::{
    AURA_NAMES, FACTION_COUNT, FACTION_NAMES, FACTION_PALETTES, GENESIS_TEMPLATES, HELMET_NAMES,
    RELIC_NAMES, SUIT_NAMES, VISOR_NAMES,
};

pub const GRID: usize = 32;
pub const PIXELS: usize = GRID * GRID;
pub const PALETTE_BYTES: usize = 45; // 15 RGB triplets for semantic slots 1..=15

/// Modular trait categories for Season 2+ Persistent registry uploads.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum LayerCategory {
    Suit = 0,
    Helmet = 1,
    Visor = 2,
    Relic = 3,
    Aura = 4,
}

/// On-chain record stored per minted Sorobit token.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SorobitRecord {
    /// 256-bit cryptographic genome:
    /// [0]=season, [1]=faction, [2]=suit, [3]=helmet, [4]=visor, [5]=relic, [6]=aura,
    /// [7..9]=recessive forge genes (latent Gen 0), [9..32]=entropy/sky seed.
    pub dna: BytesN<32>,
    /// `0` = Generative Mint, `1..=8` = Genesis Archetype (`AGQ01`..`AGQ08`), `9+` = Forge.
    pub edition: u32,
    /// `0` = Gen 0 origin, `1+` = Ascended / Forged generation.
    pub generation: u32,
    /// Epigenetic TTL Shield frame tier (`0..=4`), updates with on-chain activity.
    pub rank_tier: u32,
    /// On-chain accumulated telemetry / experience points.
    pub xp_score: u32,
    /// Ledger sequence at mint time (verifiable provenance).
    pub born_ledger: u32,
    /// Optional soulbound lock for merit-only Genesis/rank credentials.
    pub soulbound: bool,
}

/// Stack byte writer avoiding heap allocation in `no_std` Soroban WASM.
pub struct ByteWriter {
    buf: [u8; 16_384],
    len: usize,
}

impl ByteWriter {
    pub fn new() -> Self {
        Self {
            buf: [0u8; 16_384],
            len: 0,
        }
    }

    #[inline]
    pub fn push_byte(&mut self, b: u8) {
        if self.len >= self.buf.len() {
            panic!("svg buffer capacity exceeded");
        }
        self.buf[self.len] = b;
        self.len += 1;
    }

    pub fn push_bytes(&mut self, src: &[u8]) {
        let end = self.len + src.len();
        if end > self.buf.len() {
            panic!("svg buffer capacity exceeded");
        }
        self.buf[self.len..end].copy_from_slice(src);
        self.len = end;
    }

    #[inline]
    pub fn push_str(&mut self, s: &str) {
        self.push_bytes(s.as_bytes());
    }

    pub fn push_u32(&mut self, mut n: u32) {
        if n == 0 {
            self.push_byte(b'0');
            return;
        }
        let mut tmp = [0u8; 10];
        let mut idx = 0;
        while n > 0 {
            tmp[idx] = b'0' + (n % 10) as u8;
            n /= 10;
            idx += 1;
        }
        while idx > 0 {
            idx -= 1;
            self.push_byte(tmp[idx]);
        }
    }

    pub fn push_hex_rgb(&mut self, rgb: &[u8; 3]) {
        const HEX: &[u8; 16] = b"0123456789ABCDEF";
        self.push_byte(b'#');
        for &c in rgb {
            self.push_byte(HEX[(c >> 4) as usize]);
            self.push_byte(HEX[(c & 0x0F) as usize]);
        }
    }

    pub fn to_soroban_string(&self, e: &Env) -> String {
        String::from_bytes(e, &self.buf[..self.len])
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }
}

/// Validates packed `(len, val)` RLE stream decodes to exact 1,024 pixels in semantic range `0..=15`.
pub fn validate_rle_layer(bytes: &[u8]) -> bool {
    if bytes.is_empty() || !bytes.len().is_multiple_of(2) {
        return false;
    }
    let mut total: usize = 0;
    let mut i = 0;
    while i < bytes.len() {
        let count = bytes[i] as usize;
        let slot = bytes[i + 1];
        if count == 0 || slot > 15 {
            return false;
        }
        total += count;
        if total > PIXELS {
            return false;
        }
        i += 2;
    }
    total == PIXELS
}

/// Perceptual relative luminance scaled by 10_000_000 (avoids floating point in `no_std`).
#[inline]
fn scaled_luminance(r: u8, g: u8, b: u8) -> u32 {
    2126 * (r as u32) + 7152 * (g as u32) + 722 * (b as u32)
}

/// Enforces Sorobits mathematical PaletteSwap invariants on 45-byte palettes (slots 1..=15):
/// - Monotonic luminance on Suit (1<2<3), Visor (4<5<6), Helmet (7<8<9), Metal (10<11), Relic (12<13), Sky (14<15)
/// - Visor highlight L(6) >= 85%, Sky accent L(15) <= 42%, never pure #000000 outline at slot 7.
pub fn validate_palette45(pal: &[u8]) -> bool {
    if pal.len() != PALETTE_BYTES {
        return false;
    }
    let mut lums = [0u32; 16];
    for (s, lum) in lums.iter_mut().enumerate().skip(1) {
        let base = (s - 1) * 3;
        *lum = scaled_luminance(pal[base], pal[base + 1], pal[base + 2]);
    }
    // Never pure #000000 sel-out dark at slot 7 (index 6*3..6*3+3)
    if pal[18] == 0 && pal[19] == 0 && pal[20] == 0 {
        return false;
    }
    // 255 * 10000 = 2_550_000 max scaled luminance
    const MIN_STEP: u32 = 102_000; // ~4% of 2_550_000
    for &(a, b) in &[
        (1, 2),
        (2, 3),
        (4, 5),
        (5, 6),
        (7, 8),
        (8, 9),
        (10, 11),
        (12, 13),
        (14, 15),
    ] {
        if lums[b] <= lums[a] || (lums[b] - lums[a]) < MIN_STEP {
            return false;
        }
    }
    // L(6) >= 85% of 2_550_000 = 2_167_500; L(15) <= 42% = 1_071_000
    if lums[6] < 2_167_500 || lums[15] > 1_071_000 {
        return false;
    }
    true
}

/// Deterministic `xorshift32` cosmos sky mirroring `scripts/sorobits_studio.py`.
pub fn render_procedural_sky(seed: &[u8], buf: &mut [u8; PIXELS]) {
    buf.fill(14);
    let mut h = u32::from_le_bytes([seed[9], seed[10], seed[11], seed[12]]);
    if h == 0 {
        h = 0x9E37_79B9;
    }
    let mut next_u32 = || -> u32 {
        h ^= h << 13;
        h ^= h >> 17;
        h ^= h << 5;
        h
    };

    let horizon_y = 12 + (next_u32() % 5) as usize;
    for y in horizon_y..(horizon_y + 3) {
        for x in 0..GRID {
            if (x + y) % 2 == 0 {
                buf[y * GRID + x] = 15;
            }
        }
    }
    for y in 23..27usize {
        for x in 0..GRID {
            if (x + y) % 2 == 0 {
                buf[y * GRID + x] = 15;
            }
        }
    }

    // Top-left 4-point Polar Navigation Star
    let sx = 4 + (next_u32() % 2) as usize;
    let sy = 4 + (next_u32() % 2) as usize;
    buf[(sy - 1) * GRID + sx] = 8;
    buf[(sy + 1) * GRID + sx] = 8;
    buf[sy * GRID + (sx - 1)] = 8;
    buf[sy * GRID + (sx + 1)] = 8;
    buf[sy * GRID + sx] = 9;

    // Sparse distant 1x1 background stars outside hero center box
    let star_count = 4 + (next_u32() % 3);
    for _ in 0..star_count {
        let x = 2 + (next_u32() % 28) as usize;
        let y = 2 + (next_u32() % 24) as usize;
        if (7..=24).contains(&x) && (6..=28).contains(&y) {
            continue;
        }
        buf[y * GRID + x] = if next_u32() % 3 != 0 { 8 } else { 9 };
    }
}

/// Applies non-zero (`>0`) RLE pixels over the `[u8; 1024]` Z-buffer.
pub fn overlay_rle(rle: &[u8], buf: &mut [u8; PIXELS]) {
    let mut pos: usize = 0;
    let mut i: usize = 0;
    while i + 1 < rle.len() && pos < PIXELS {
        let count = rle[i] as usize;
        let slot = rle[i + 1];
        let end = (pos + count).min(PIXELS);
        if slot != 0 {
            for p in &mut buf[pos..end] {
                *p = slot;
            }
        }
        pos = end;
        i += 2;
    }
}

/// Paints Epigenetic TTL Shield frame (`<=1px` perimeter + corner HUD brackets) directly into Z-buffer.
pub fn overlay_frame(rank_tier: u32, buf: &mut [u8; PIXELS]) {
    let set = |grid: &mut [u8; PIXELS], x: usize, y: usize, slot: u8| {
        grid[y * GRID + x] = slot;
    };
    match rank_tier {
        0 => {
            // OriginHUD: 3px Parallel-style corner brackets only
            let corners: [(isize, isize, isize, isize); 4] = [
                (0, 0, 1, 1),
                (31, 0, -1, 1),
                (0, 31, 1, -1),
                (31, 31, -1, -1),
            ];
            for (cx, cy, dx, dy) in corners {
                set(buf, cx as usize, cy as usize, 11);
                set(buf, (cx + dx) as usize, cy as usize, 8);
                set(buf, (cx + 2 * dx) as usize, cy as usize, 8);
                set(buf, cx as usize, (cy + dy) as usize, 8);
                set(buf, cx as usize, (cy + 2 * dy) as usize, 8);
            }
        }
        1 => {
            // ArchivalBronze: 1px chamfered bezel + single corner telemetry pip
            for i in 1..31usize {
                set(buf, i, 0, 10);
                set(buf, i, 31, 10);
                set(buf, 0, i, 10);
                set(buf, 31, i, 10);
            }
            set(buf, 29, 1, 11);
            set(buf, 30, 1, 11);
            set(buf, 30, 2, 11);
        }
        2 => {
            // SovereignTTL: gold rim + 4 jewel corners + dual telemetry pips
            for i in 1..31usize {
                set(buf, i, 0, 11);
                set(buf, i, 31, 10);
                set(buf, 0, i, 11);
                set(buf, 31, i, 10);
            }
            set(buf, 0, 0, 6);
            set(buf, 31, 0, 6);
            set(buf, 0, 31, 11);
            set(buf, 31, 31, 11);
            set(buf, 29, 1, 13);
            set(buf, 30, 2, 13);
            set(buf, 2, 1, 13);
            set(buf, 1, 2, 13);
        }
        3 => {
            // YardstickPrism: obsidian 1px frame + radiant 4px HUD corners
            for i in 1..31usize {
                set(buf, i, 0, 10);
                set(buf, i, 31, 10);
                set(buf, 0, i, 10);
                set(buf, 31, i, 10);
            }
            let corners: [(isize, isize, isize, isize); 4] = [
                (0, 0, 1, 1),
                (31, 0, -1, 1),
                (0, 31, 1, -1),
                (31, 31, -1, -1),
            ];
            for (cx, cy, dx, dy) in corners {
                set(buf, cx as usize, cy as usize, 6);
                set(buf, (cx + dx) as usize, cy as usize, 13);
                set(buf, (cx + 2 * dx) as usize, cy as usize, 5);
                set(buf, cx as usize, (cy + dy) as usize, 13);
                set(buf, cx as usize, (cy + 2 * dy) as usize, 5);
            }
            set(buf, 1, 1, 13);
            set(buf, 30, 1, 13);
        }
        _ => {
            // Clean Void (borderless grail frame, rank >= 4)
        }
    }
}

/// Applies collision/exclusion rules between helmets, relics, and auras.
pub fn sanitize_genes(helmet: u8, visor: u8, relic: &mut u8, aura: &mut u8) {
    // VoidHood (3) cannot wear protruding LedgerAntenna (1), SovereignCrown (3), or SorobanCrown (6)
    if helmet == 3 && (*relic == 1 || *relic == 3 || *relic == 6) {
        *relic = 7; // Upgrade safely to floating StroopOrb
    }
    // Keep top-right open when TwinLaser (4) + StroopOrb (7) are paired
    if visor == 4 && *relic == 7 && *aura == 2 {
        *aura = 0;
    }
}

/// Writes crisp per-color `<path>` SVG elements from the already-composited `[u8; 1024]` grid.
pub fn write_svg(
    w: &mut ByteWriter,
    grid: &[u8; PIXELS],
    pal45: &[u8; PALETTE_BYTES],
    animated: bool,
) {
    w.push_str(
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' shape-rendering='crispEdges'>",
    );
    if animated {
        w.push_str("<style>@keyframes p{0%,100%{opacity:1}50%{opacity:.65}}.v{animation:p 5s infinite}</style>");
    }

    // Slot 14 forms the base deep-space rect covering all 32x32 pixels
    let bg = [pal45[13 * 3], pal45[13 * 3 + 1], pal45[13 * 3 + 2]];
    w.push_str("<rect width='32' height='32' fill='");
    w.push_hex_rgb(&bg);
    w.push_str("'/>");

    // Emit at most 1 <path> per semantic color slot (1..=15 excluding base sky 14)
    for slot in 1..=15u8 {
        if slot == 14 {
            continue;
        }
        // Check if slot appears anywhere before emitting `<path>` tag
        if !grid.contains(&slot) {
            continue;
        }
        let rgb_i = (slot as usize - 1) * 3;
        let rgb = [pal45[rgb_i], pal45[rgb_i + 1], pal45[rgb_i + 2]];
        w.push_str("<path ");
        if animated && (slot == 5 || slot == 6) {
            w.push_str("class='v' ");
        }
        w.push_str("fill='");
        w.push_hex_rgb(&rgb);
        w.push_str("' d='");

        for y in 0..GRID {
            let row = &grid[y * GRID..(y + 1) * GRID];
            let mut x = 0usize;
            while x < GRID {
                if row[x] == slot {
                    let mut width = 1usize;
                    while x + width < GRID && row[x + width] == slot {
                        width += 1;
                    }
                    w.push_byte(b'M');
                    w.push_u32(x as u32);
                    w.push_byte(b' ');
                    w.push_u32(y as u32);
                    w.push_byte(b'h');
                    w.push_u32(width as u32);
                    w.push_str("v1h-");
                    w.push_u32(width as u32);
                    w.push_byte(b'z');
                    x += width;
                } else {
                    x += 1;
                }
            }
        }
        w.push_str("'/>");
    }
    w.push_str("</svg>");
}

pub fn frame_name(rank_tier: u32) -> &'static str {
    match rank_tier {
        0 => "OriginHUD",
        1 => "ArchivalBronze",
        2 => "SovereignTTL",
        3 => "YardstickPrism",
        _ => "CleanVoid",
    }
}

pub fn faction_name(id: u8) -> &'static str {
    let idx = (id as usize) % FACTION_COUNT;
    FACTION_NAMES[idx]
}

pub fn trait_name(cat: LayerCategory, id: u8) -> &'static str {
    match cat {
        LayerCategory::Suit => SUIT_NAMES.get(id as usize).copied().unwrap_or("CustomSuit"),
        LayerCategory::Helmet => HELMET_NAMES
            .get(id as usize)
            .copied()
            .unwrap_or("CustomHelmet"),
        LayerCategory::Visor => VISOR_NAMES
            .get(id as usize)
            .copied()
            .unwrap_or("CustomVisor"),
        LayerCategory::Relic => RELIC_NAMES
            .get(id as usize)
            .copied()
            .unwrap_or("CustomRelic"),
        LayerCategory::Aura => AURA_NAMES.get(id as usize).copied().unwrap_or("CustomAura"),
    }
}

/// Copies a Season 1 constant palette/layer or reads a Season 2+ Persistent custom entry.
pub fn resolve_palette(custom: Option<Bytes>, faction_id: u8) -> [u8; PALETTE_BYTES] {
    if let Some(b) = custom {
        if b.len() as usize == PALETTE_BYTES {
            let mut out = [0u8; PALETTE_BYTES];
            b.copy_into_slice(&mut out);
            return out;
        }
    }
    FACTION_PALETTES[(faction_id as usize) % FACTION_COUNT]
}

pub fn apply_optional_rle(custom: Option<Bytes>, season1_fallback: &[u8], grid: &mut [u8; PIXELS]) {
    if let Some(b) = custom {
        let len = b.len() as usize;
        if len > 0 && len <= 2048 {
            let mut tmp = [0u8; 2048];
            b.copy_into_slice(&mut tmp[..len]);
            overlay_rle(&tmp[..len], grid);
            return;
        }
    }
    overlay_rle(season1_fallback, grid);
}

/// Verifies a validated RLE layer renders comfortably inside `ByteWriter`'s static SVG/JSON budget.
pub fn validate_rle_render_budget(bytes: &[u8], pal45: &[u8; PALETTE_BYTES]) -> bool {
    let mut grid = [14u8; PIXELS];
    overlay_rle(bytes, &mut grid);
    overlay_frame(3, &mut grid);
    let mut w = ByteWriter::new();
    // Conservative dry-run: count SVG bytes including worst-case `@keyframes` overhead,
    // keeping >= 3 KB margin for `token_uri` JSON metadata wrapper.
    const MAX_SVG_BUDGET: usize = 12_800;
    let mut runs: usize = 0;
    for y in 0..GRID {
        let row = &grid[y * GRID..(y + 1) * GRID];
        let mut x = 0usize;
        while x < GRID {
            let s = row[x];
            let mut width = 1usize;
            while x + width < GRID && row[x + width] == s {
                width += 1;
            }
            if s != 14 {
                runs += 1;
            }
            x += width;
        }
    }
    // Each `<path>` run is ~16 bytes max (`M31 31h32v1h-32z`); cap runs early before full render.
    if runs > 720 {
        return false;
    }
    write_svg(&mut w, &grid, pal45, true);
    w.len() <= MAX_SVG_BUDGET
}

/// Resolves full 32x32 grid from Season 1 compiled constants cleanly.
#[cfg(test)]
#[allow(dead_code)]
pub fn compose_season1_grid(dna: &[u8; 32], rank_tier: u32) -> [u8; PIXELS] {
    use crate::assets::{AURA_LAYERS, HELMET_LAYERS, RELIC_LAYERS, SUIT_LAYERS, VISOR_LAYERS};
    let mut grid = [0u8; PIXELS];
    render_procedural_sky(dna, &mut grid);
    overlay_rle(
        AURA_LAYERS[(dna[6] as usize) % AURA_LAYERS.len()],
        &mut grid,
    );
    overlay_rle(
        SUIT_LAYERS[(dna[2] as usize) % SUIT_LAYERS.len()],
        &mut grid,
    );
    overlay_rle(
        HELMET_LAYERS[(dna[3] as usize) % HELMET_LAYERS.len()],
        &mut grid,
    );
    overlay_rle(
        VISOR_LAYERS[(dna[4] as usize) % VISOR_LAYERS.len()],
        &mut grid,
    );
    overlay_rle(
        RELIC_LAYERS[(dna[5] as usize) % RELIC_LAYERS.len()],
        &mut grid,
    );
    overlay_frame(rank_tier, &mut grid);
    grid
}

/// Builds complete SEP-50 `data:application/json;utf8,...` with inline SVG & rich Stellar traits.
pub fn write_token_uri_json(
    w: &mut ByteWriter,
    token_id: u32,
    rec: &SorobitRecord,
    dna: &[u8; 32],
    grid: &[u8; PIXELS],
    pal45: &[u8; PALETTE_BYTES],
) {
    w.push_str("data:application/json;utf8,{\"name\":\"Sorobit #");
    w.push_u32(token_id);
    if (1..=8).contains(&rec.edition) {
        let g = &GENESIS_TEMPLATES[(rec.edition - 1) as usize];
        w.push_str(" · ");
        w.push_str(g.code);
        w.push_byte(b' ');
        w.push_str(g.title);
    }
    w.push_str("\",\"description\":\"100% on-chain 32x32 genomic pixel art on Stellar Soroban. Built by NunaLabs for AstroGate.\",\"attributes\":[");

    w.push_str("{\"trait_type\":\"Faction\",\"value\":\"");
    w.push_str(faction_name(dna[1]));
    w.push_str("\"},{\"trait_type\":\"Suit\",\"value\":\"");
    w.push_str(trait_name(LayerCategory::Suit, dna[2]));
    w.push_str("\"},{\"trait_type\":\"Helmet\",\"value\":\"");
    w.push_str(trait_name(LayerCategory::Helmet, dna[3]));
    w.push_str("\"},{\"trait_type\":\"Visor\",\"value\":\"");
    w.push_str(trait_name(LayerCategory::Visor, dna[4]));
    w.push_str("\"},{\"trait_type\":\"Relic\",\"value\":\"");
    w.push_str(trait_name(LayerCategory::Relic, dna[5]));
    w.push_str("\"},{\"trait_type\":\"Aura\",\"value\":\"");
    w.push_str(trait_name(LayerCategory::Aura, dna[6]));
    w.push_str("\"},{\"trait_type\":\"TTL Shield\",\"value\":\"");
    w.push_str(frame_name(rec.rank_tier));
    w.push_str("\"},{\"trait_type\":\"Season\",\"value\":");
    w.push_u32(dna[0] as u32);
    w.push_str("},{\"trait_type\":\"Generation\",\"value\":");
    w.push_u32(rec.generation);
    w.push_str("},{\"trait_type\":\"XP\",\"value\":");
    w.push_u32(rec.xp_score);
    w.push_str("},{\"trait_type\":\"Born Ledger\",\"value\":");
    w.push_u32(rec.born_ledger);
    if (1..=8).contains(&rec.edition) {
        let g = &GENESIS_TEMPLATES[(rec.edition - 1) as usize];
        w.push_str("},{\"trait_type\":\"Stellar Era\",\"value\":\"");
        w.push_str(g.era);
        w.push_byte(b'"');
    }
    w.push_str("}],\"image\":\"data:image/svg+xml;utf8,");
    write_svg(w, grid, pal45, false);
    w.push_str("\"}");
}
