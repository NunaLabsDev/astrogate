# Sorobits (`SBIT`) — Arquitectura de Colección NFT 100% On-Chain

> **Estudio / Marca:** Built by NunaLabs · Colección oficial de **AstroGate** sobre **Stellar / Soroban**
> **Estado:** Fase 1 implementada y desplegada en **Stellar Testnet** (`CBVETCPLVAMNUUQRUJGH54XHVQT5ZOVB4FGGP2IGOGAZLUIYBBV7G3I3`)
> **WASM Hash (optimizado, 74,229 B):** `c668ebba24880a46202e6746009a95a62d1893207f678db3422d8194154f17fd`
> **Red objetivo:** Stellar Testnet primero (sin fondos reales ni mainnet durante MVP; ver `GEMINI.md` / `AGENTS.md`).

---

## 1. Visión y Decisión Estratégica

**Sorobits (`SBIT`)** es una colección NFT nativa de **Stellar Soroban (`no_std`)** cuyo arte pixel-art `32×32`, genética criptográfica (`Genome`), rarezas y metadatos **viven al 100% dentro del ledger** —sin depender de Pinata, IPFS ni servidores externos—.

### Regla de diseño acordada: *Núcleo inmutable y enfocado + Satélites evolutivos*
1. **No hacer reproducción ilimitada:** Evita diluir el supply como ocurrió históricamente en juegos de *breeding* inflacionario.
2. **Mutación deflacionaria (*Forge*) en Fase 2:** Quemar piezas existentes (`NonFungibleBurnable`) o usar catalizadores escasos para forjar variantes míticas, reduciendo o manteniendo acotada la oferta circulante.
3. **Núcleo V1 eterno, reglas de campaña actualizables:** El contrato principal `SorobitsNft` nunca cambia de dirección; las misiones (`QuestMinter`), la forja (`SorobitsForge`) y futuros accesorios operan como contratos satélite con roles revocables.

---

## 2. Stack y Estándares (OpenZeppelin Stellar)

El workspace raíz ([Cargo.toml](../Cargo.toml)) ya fija las dependencias compatibles:
- `soroban-sdk = "28.0.0"`
- `stellar-tokens = "=0.8.0"`
- `stellar-access = "=0.8.0"`
- `stellar-macros = "=0.8.0"`

Sobre `stellar-tokens::non_fungible` (**SEP-50**), `contracts/sorobits` integrará:
- **`NonFungibleToken` + `sequential`:** IDs secuenciales limpios (`1, 2, 3...`), `owner_of`, `transfer`, `approve`, `token_uri`.
- **`NonFungibleEnumerable` (`enumerable`):** Enumeración on-chain de tokens por propietario y supply total para consulta directa desde `@AstroGateSorobanBot` y la Mini App sin base de datos ni indexador obligatorio.
- **`NonFungibleRoyalties` (`royalties`, estilo ERC-2981):** Royalties globales y por token configurables hacia `astrogate-treasury` o pools comunitarios.
- **`NonFungibleBurnable` (`burnable`):** Quema verificable para futura forja deflacionaria o ascensión de rango.
- **`NonFungibleVotes` (`votes`):** Peso de voto on-chain para gobernanza del ecosistema AstroGate.
- **`stellar-access`:** Separación estricta de roles (`Admin`, `Curator`, `Minter`, `TelemetryUpdater`).

---

## 3. Datos Reales Medidos sobre los Sprites Actuales (`AGQ01`–`AGQ08`)

Análisis verificado sobre los 8 badges `32×32` (`512×512` display) ya diseñados en `frontend/public/badges/`:
- `pioneer.png`, `launcher.png`, `shouter.png`, `graduate.png`, `og.png`, `whale.png`, `phoenix.png`, `legend.png`

Medición exacta por sprite `32×32` (`1,024` píxeles):
- **Colores en paleta:** `19–22` colores RGB (`57–66 bytes`)
- **Runs RLE horizontales:** `334–379` runs (`668–758 bytes`)
- **Peso total comprimido (paleta + RLE):** **`731–818 bytes`** por sprite completo (frente al límite máximo de `64 KiB / 65,536 bytes` por entrada en storage Soroban y `250 bytes` por clave).
- **Runs saltando el fondo dominante:** `292–352` rectángulos.
- **Optimización SVG por color:** Al agrupar los runs en **1 `<path>` por color** (`M{x} {y}h{w}v1h-{w}z` con `shape-rendering='crispEdges'`), cada NFT genera solo **`19–22` nodos `<path>`** en lugar de ~350 `<rect>`.

---

## 4. Motor Genómico y Compositor Raster `32×32` (`no_std`)

### 4.1 Genoma Inmutable de 256 bits (`BytesN<32>`)
Cada `token_id` almacena un genoma compacto de 32 bytes derivado determinísticamente con `env.crypto().sha256(...)` + semilla de ledger + invocador + ID secuencial:

```text
[256-bit Genome = BytesN<32>]
├── Bits   0..31 : Arquetipo / Origen (Genesis AGQ01–AGQ08 · Piloto · Cyborg · Void · Holo)
├── Bits  32..63 : Paleta Genética (PaletteSwap: Cyan Neon, Solar Gold, Mars Crimson, Obsidian...)
├── Bits  64..159: 6 Genes Dominantes visibles (Fondo · Aura · Traje · Casco · Visor · Reliquia)
├── Bits 160..191: Gen Recesivo oculto (latente en Gen 0; despierta al fusionar/mutar en Fase 2)
├── Bits 192..223: Epigenética / Telemetría viva (rank_tier, burns_fueled, launches_witnessed)
└── Bits 224..255: Temporada, Edición (Genesis/Standard/Mythic), Flag Soulbound y Checksum
```

### 4.2 Índices Semánticos + `PaletteSwap`
Las capas compartidas no guardan colores RGB fijos, sino **índices semánticos (`0..15`)**:
- `0` = transparente
- `1–3` = sombras/base/brillos del traje
- `4–6` = tonos y destellos del visor
- `7–9` = casco y contorno selectivo (*selective outlining*)
- `10–15` = acentos metálicos, energía y aura

Con esto, la misma geometría pixel-art produce variantes con sombreado y *hue-shifting* profesional sin ocupar bytes extra de geometría.

### 4.3 Z-Buffer `32×32` en Stack (`[u8; 1024]`) + Cielo Procedural
Al invocar `token_uri(token_id)` o `raw_bitmap(token_id)`:
1. **Fondo generativo sin mapa de bits:** Un PRNG determinístico (*xorshift*) sembrado con el `Genome` dibuja campos de estrellas (`1×1`), destellos (`3×3`) o gradientes *dithered* directamente sobre la matriz base.
2. **Composición Z-order (`[u8; 1024]`):** Escribe en orden `Aura -> Traje -> Casco -> Visor -> Reliquia -> Marco Epigenético` ignorando píxeles `0` (transparentes). Los píxeles tapados no generan XML redundante.
3. **Emisión dual nativa:**
   - `token_uri(token_id)` → `data:application/json;utf8,{"name":...,"image":"data:image/svg+xml;utf8,...","attributes":[...]}` (compatible directo con wallets y exploradores SEP-50).
   - `animated_svg(token_id)` → SVG opcional con `<animate>` ligero (pulso del visor / parpadeo estelar) para Mini App y galería.
   - `raw_bitmap(token_id)` → bytes resueltos `32×32` para `<canvas>` y futuros mini-juegos.

---

## 5. Mecánicas de Valor, Seguridad y Buenas Prácticas

### 5.1 Palancas de valor en la red
1. **Inmutabilidad sellada (`seal_season(season_id)`):** Una vez verificados y cargados los sprites/capas de una temporada, `Curator` sella la temporada de forma irreversible; nadie puede alterar el arte jamás.
2. **Badges Genesis (`AGQ01`–`AGQ08`) como Edición 0:** Los 8 badges descritos en [quests.ts](../frontend/worker/quests.ts) actúan como Arquetipos Genesis fundacionales y futuros catalizadores.
3. **Soulbound selectivo vs. Tradeable:** Insignias de rango puro pueden marcarse intransferibles (`soulbound = true`) para preservar mérito anti-sybil, mientras coleccionables y piezas forjadas mantienen transferibilidad + `NonFungibleRoyalties`.
4. **Memoria on-chain en cada token:** Telemetría acotada (`born_ledger`, `rank_tier`, `activity_score`) que añade historia verificable y actualiza el marco/aura epigenética sin tocar la identidad base del personaje.
5. **Utilidad composable Zero-Trust:**
   - Telegram (`@AstroGateCommunity` / `@AstroGateSorobanBot`): roles, prioridad en feed, multiplicador de sprints (`computePilotPerks`) y acceso VIP verificado contra RPC.
   - Launchpad ([contract.rs](../contracts/launchpad/src/contract.rs)): futuros descuentos o acceso prioritario leyendo `owner_of` / balance directamente on-chain.

### 5.2 Controles técnicos obligatorios en implementación
- **Gestión explícita de TTL (`extend_ttl`):** Renovación periódica de entradas `Persistent` (capas de arte, registros globales y genomas) en cada operación relevante para evitar archivado involuntario.
- **Presupuesto CPU y memoria medido:** Verificar `env.cost_estimate().budget()` en `cargo test` para `token_uri()` antes de desplegar en testnet.
- **Validación estricta:** Límites de dimensiones (`32×32`), máximo de colores/runs, rechazo de coordenadas inválidas y tests adversarios desde V1.
- **Sin claves ni admins omnipresentes:** Ningún rol administrativo puede mover o quemar tokens ajenos sin autorización del dueño.

---

## 6. Hoja de Ruta de Implementación

### Fase 1 — Núcleo `contracts/sorobits` (V1)
- [x] Crear crate `contracts/sorobits` y registrarlo en [Cargo.toml](../Cargo.toml).
- [x] Implementar módulo SEP-50 (`NonFungibleToken`, `sequential`, `Enumerable`, `Royalties`, `Burnable`) + `AccessControl`.
- [x] Implementar `PixelArtEngine` (`[u8; 1024]` compositor, RLE + `PaletteSwap`, cielo procedural, SVG `<path>` por color, `seal_season()`).
- [x] Implementar `Genome` de 256 bits + telemetría epigenética básica.
- [x] Crear script encoder ([sorobits_studio.py](../scripts/sorobits_studio.py) `--emit-rust`) para convertir los 8 Genesis `AGQ01`–`AGQ08` y 25 capas a constantes RLE (`2,222 B`).
- [x] Suite completa `cargo test -p astro-sorobits-contract` (11/11 tests y medición real de `budget()` CPU/memoria).
- [x] Despliegue en **Stellar Testnet** (`CBVETCPLVAMNUUQRUJGH54XHVQT5ZOVB4FGGP2IGOGAZLUIYBBV7G3I3`) + mint Genesis `#0` (`AGQ01 Pioneer`) + generación de bindings TS (`npm run bindings`).

### Fase 2 — Ecosistema y Evolución (Contratos Satélite + App)
- [ ] `QuestMinter`: verificación automática de logros on-chain del Launchpad y reclamo directo desde Mini App / `@AstroGateSorobanBot`.
- [ ] `SorobitsForge`: quema deflacionaria de piezas / catalizadores para despertar genes recesivos (`Gen 1+`).
- [ ] Integración completa en `PortfolioPage.tsx` y bot (`render` nativo directo desde contrato en Testnet).
