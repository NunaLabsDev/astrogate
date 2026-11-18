# Sorobits (`SBIT`) — Biblia Visual, Pipeline Artístico y Anatomía de Colección

> **Estudio / Marca:** Built by NunaLabs · **AstroGate** (Stellar / Soroban)
> **Documento técnico hermano:** [SOROBITS_ARCHITECTURE.md](./SOROBITS_ARCHITECTURE.md)
> **Estado:** Guía maestra consolidada a partir de 4 auditorías especializadas (*Pixel Art Craft*, *Pipeline & Tools*, *Concept & Lore*, *Collector Projects & Card Anatomy*).

---

## 1. Universo y Concepto: *The AstroGate Crossing*

Más allá del horizonte de Stellar se abre el **Floodgate**, la puerta estelar donde la liquidez cruda condensa nuevos mundos (curvas *Fair-Flywheel*) y solo los pilotos disciplinados cruzan hacia la órbita de **Soroswap**.

Cada **Sorobit (`SBIT`)** es el **retrato telemétrico de caja negra (*cockpit black-box portrait*)** de un astro-piloto que cruzó la puerta. No son stickers sueltos: cada capa del compositor `[u8; 1024]` representa una pieza real del traje de vuelo y la trayectoria del piloto:

| Capa Z (`[u8; 1024]`) | Rol en el Lore | Anclaje Visual en `32×32` |
| :--- | :--- | :--- |
| **0. Cielo Procedural** | *Warp Sector* de nacimiento (`born_ledger`). | Vacío profundo + banda dithered de horizonte (`y≈13–15`, `y≈22–25`) + estrella polar de 4px + estrellas PRNG. |
| **1. Aura** | *Warp Wake* / radiación residual del salto. | Halo sutil tras el traje; despierta fuerte en mutaciones `Gen 1+` de la Forja. |
| **2. Traje (`Suit`)** | Armadura de vuelo y núcleo de telemetría. | Hombros anchos con broches + placa pectoral con el **AstroGate Chevron (3px)** (en `AGQ04 Graduate`, pantalla esmeralda limpia). |
| **3. Casco (`Helmet`)** | Casco atmosférico + transmisor izquierdo. | Domo con luz cenital-izquierda, *sel-out* y crestas míticas que rompen silueta superior (*Antena, Pluma, Corona, Halo, Obelisco*). |
| **4. Visor (`Visor`)** | Óptica de lectura del mercado y del ledger. | **Ancla de marca ("Regla Noggles"):** franja fija en `y: 11..15` (estándar, *3D Anaglyph* en `AGQ05`, *Twin Laser* en `AGQ07`). |
| **5. Reliquia (`Relic`)** | Hardware de vuelo o catalizador de misión. | Artefactos en hombro o esquina libre (`x/y` sin tapar el visor). |
| **6. Marco Epigenético** | Sello vivo de rango en la red. | Bisel arquitectónico máximo de `1–2px` + micro-nodos (`2×2`/`3×3`) que reflejan `rank_tier`, `Edition 0` o `Gen 1+`. |

---

## 2. Facciones Cromáticas (`PaletteSwap` sobre Slots `0..15`)

Cada tema de paleta sustituye los slots semánticos manteniendo **luminancia perceptual estrictamente creciente** (`Y = 0.2126R + 0.7152G + 0.0722B`) y **hue-shifting** (sombras hacia tonos fríos, luces hacia tonos cálidos/eléctricos).

| Facción / Tema | Rampa Visual (Sombra → Base → Luz + Acento) | Arquetipo y Valor Coleccionista |
| :--- | :--- | :--- |
| **Horizon Signal** | Azul abisal → Cobalto → Cielo hielo · Pips rojo/violeta | Exploradores que abren la puerta (`AGQ01 Pioneer`). |
| **Aether Forge** | Índigo oscuro → Ultravioleta → Lila pálido · Broches oro solar | Arquitectos de lanzamientos (`AGQ02 Launcher`, `AGQ05 OG`). |
| **Solar Sovereign** | Granate profundo → Carmesí/Ámbar → Oro crema · Chispas rubí/cyan | Dominantes del feed y quemas (`AGQ03 Shouter`, `AGQ07 Phoenix`). |
| **Soroswap Jade** | Pino abisal → Esmeralda → Menta claro · Collar/halo oro | Navegantes graduados a AMM (`AGQ04 Graduate`). |
| **Abyssal Trench** | Azul fosa → Cerúleo → Espuma marina · Remaches ámbar | Ballenas de liquidez profunda (`AGQ06 Whale`). |
| **Void Obsidian** | Carbón bronce → Ocre bruñido → Marfil oro · Óptica cyan hielo | Míticos ascendidos / *Clean Stealth Grail* (`AGQ08 Legend`). |
| **Quantum Holo** | Cambio prismático teal-magenta · Borde cyan-blanco de alto contraste | Exclusivo `Gen 1+` despertado en `SorobitsForge` (Fase 2). |

---

## 3. Reglas Maestras de Pixel Art `32×32`

### 3.1 Geometría, Silueta y Clústeres
1. **Prueba de Silueta (Ciega a Color):** Rellenar el personaje fusionado (`Traje + Casco + Visor + Reliquia`) en negro sólido sobre blanco debe leerse al instante a `32px` y `48px`.
2. **Clústeres antes que puntos sueltos:** Trabajar con masas conectadas (`≥2` píxeles). Menos ruido `1×1` eleva la estética y reduce aún más el tamaño RLE en Soroban (por debajo de las `334–379` runs medidas en los 8 badges actuales).
3. **Cero *Pillow Shading*, *Banding*, *Doubles* ni Huérfanos:**
   - **Fuente de luz única global:** Superior-izquierda (`10–11` en punto) consistente en todas las capas.
   - **Curvas limpias:** Progresiones de pasos monótonas (ej. `4→3→2→1→2→3→4`), sin *doubles* en esquinas diagonales ni *onion-ring banding*.
   - **Dithering restringido al cielo:** Prohibido usar *checkerboard dithering* sobre cascos o trajes (vibra/emborrona en miniaturas `32–64px`); reservarlo solo para bandas de horizonte en el fondo.

### 3.2 *Selective Outlining (`Sel-Out`)* y Mapa de 16 Slots
Nunca usar negro plano `#000000` en contornos: se pierde sobre el cielo oscuro.

| Slot | Rol Semántico | Luminancia (`L*`) | Regla de Diseño y *Hue-Shift* |
| :--- | :--- | :--- | :--- |
| `0` | Transparente | — | Omitido en Z-buffer y RLE |
| `1` | Traje Sombra | `18–30%` | Tono desplazado a frío, saturación media |
| `2` | Traje Base | `42–58%` | Identidad cromática principal (máxima saturación del material) |
| `3` | Traje Luz | `68–80%` | Desplazado a cálido, saturación más baja |
| `4` | Visor Vidrio Oscuro | `10–20%` | Cristal profundo con tinte (nunca `#000000`) |
| `5` | Visor Reflejo / Neón | `55–72%` | Acento complementario o firma de facción |
| `6` | Visor Destello Especular | `90–98%` | **Ancla de contraste #1** (`S ≤ 15%`), slash diagonal `2–3px` |
| `7` | Contorno Oscuro (*Sel-Out*) | `5–14%` | Lado en sombra (abajo/derecha), tinte oscuro de facción |
| `8` | Casco / *Sel-Out* Medio | `30–45%` | Lado iluminado del contorno y curvatura inferior |
| `9` | Casco Luz / Rim | `75–88%` | Rebote cenital-izquierdo del domo |
| `10` | Metal Sombra | `22–35%` | Bronce/titanio/acero en sombra |
| `11` | Metal Luz | `78–90%` | Broches, cuello, antenas, remaches |
| `12` | Energía / Reliquia Base | `50–65%` | Láseres, llamas, halos de alta saturación |
| `13` | Energía Núcleo | `85–95%` | Centro incandescente desaturado hacia blanco |
| `14` | Cielo / Aura Oscuro | `8–18%` | Base del fondo cósmico |
| `15` | Cielo / Aura Acento | `25–42%` | Nebulosa/dither de **bajo contraste** para que el héroe salte |

**Invariante matemático obligatorio en `PaletteSwap`:** Para toda paleta válida debe cumplirse `L(1) < L(2) < L(3)`, `L(4) < L(5) < L(6)` y `L(7) < L(8) < L(9)`.

---

## 4. Anatomía de Coleccionismo (*Grail Engineering* en `32×32`)

Síntesis de benchmarks élite (*CryptoPunks, Chain Runners, Nouns, Autoglyphs, Fidenza, Checks VV, Parallel TCG, Sorare, Stellar Quest*):

1. **Presupuesto Espacial Estricto (`32×32 = 1,024 px`):**
   - **Zona segura del piloto (`Traje + Casco`):** `x: 3..28`, `y: 6..29` (dejando `y: 0..5` libre para crestas épicas y `2px` de margen lateral).
   - **Ancla invariante ("Regla Noggles"):** La zona del visor (`y: 11..15`, ancho `12–16px` centrado) + los broches/chevrones dan identidad instantánea a `40×40px` en Telegram, carteras y feeds.
   - **Límite duro de marco (`Marco Epigenético`):** Máximo **`1px` de perímetro + escuadras/pips de `2×2` o `3×3` en 1–2 esquinas** (nunca `≥3px`, porque un borde de 3px devora el 34% del lienzo `32×32`).
   - **Espacio negativo mínimo (`≥30%`):** Al menos ~300 píxeles deben quedar como cielo/vacío limpio para que la composición respire como *Autoglyphs* o *Parallel* en lugar de saturar la matriz.
2. **Simetría + Tensión Dinámica:**
   - Marco, hombros y domo simétricos → transmiten autoridad de artefacto/insignia coleccionable.
   - Destello del visor en diagonal, reliquia asimétrica o láser derecho → aportan energía viva.
3. **Psicología de Valor y Rarezas (*Clean Combos*):**
   - Los coleccionistas pagan prima por **combos limpios y armonía cromática** (*Void Obsidian*, *Solar Gold*, *Monochrome* o *No-Aura Clean*), no por acumulación ruidosa de accesorios.
   - Menos rasgos pero **inconfundibles** vencen a 40 variaciones casi iguales.
   - **Serial & Historia Visible:** Micro-pips epigenéticos en las esquinas distinguen *Edition 0 Genesis (`AGQ01–AGQ08`)*, rangos on-chain y piezas renacidas en `SorobitsForge` (`Gen 1+`).
   - **Estático primero, animación sutil después:** `token_uri()` entrega un artefacto fijo museográfico; `animated_svg()` añade solo pulsos discretos (`1–2px` en visor o titileo estelar).

---

## 5. Toolchain & Pipeline de Producción (De Aseprite a Soroban)

1. **Autoría Maestra (`Aseprite` como estándar · `Pixelorama` alternativa libre · `Pixaki/Pixquare` bocetado iPad):**
   - Archivo maestro `sorobits_32x32_master.aseprite` en modo **`Indexed` exacto (`0..15`)**.
   - **Regla crítica:** Usar siempre capas transparentes normales —**nunca** una capa *Background* de Aseprite, o el índice `0` se exportará opaco.
   - Capa guía bloqueada `REF_ANCHORS` marcando cuello (`y: 21..22`), caja de visor (`x: 10..21, y: 11..15`), margen del marco (`0..1`, `30..31`) y ancla de cresta (`y: 0..5`).
2. **Compilador de Assets (`scripts/sorobits_encoder.py`):**
   - Lee `.aseprite` directo en Python sin requerir GUI (`aseprite-reader` / `Pillow` para PNGs indexados existentes).
   - **Puertas QA automáticas antes de `seal_season()`:**
     1. Rechaza modo no indexado, semitransparencias o índices fuera de `0..15`.
     2. Detecta píxeles huérfanos aislados `1×1` y violaciones de zona del marco.
     3. Verifica matriz de exclusión/colisión (`OCCLUDES_VISOR`, `CREST_HEIGHT`, etc.) y simula **100,000 semillas `sha256`** Monte Carlo para auditar distribución real de rarezas.
     4. Genera hoja de contacto multi-escala (`32px`, `64px`, `512px`) y prueba de silueta negra.
3. **Fidelidad SVG Exacta (Prevención de Grietas Subpíxel):**
   - El compositor `[u8; 1024]` resuelve primero toda la superposición en RAM y solo después emite **1 `<path>` por color** (`M{x} {y}h{w}v1h-{w}z`, `shape-rendering='crispEdges'`).
   - En CI, rasterizar el SVG generado por el contrato de vuelta a `32×32` usando **`resvg --width 32 --height 32`** y exigir igualdad píxel a píxel contra la matriz de referencia.
   - En frontend/Mini App, escalar SVGs siempre a **múltiplos enteros** (`256×256`, `512×512`) o dibujar `raw_bitmap(token_id)` sobre `<canvas>` con `image-rendering: pixelated`.

---

## 6. Códice Histórico de Stellar (`2014–2026`) — Contexto Cultural en el Arte

Para que **Sorobits** no sea pixel art espacial genérico sino **patrimonio vivo de Stellar**, cada capa, paleta, marco y atributo traduce hitos reales de la red y guiños internos de sus developers:

| Era Stellar | Hito Histórico / Cultura Developer Verificada | Traducción Directa en Diseño y Rasgos de Sorobits |
| :--- | :--- | :--- |
| **2014–2015 · Génesis y el Cohete** | Fundación (2014, Jed McCaleb & Joyce Kim), emblemático **Rocket Logo** (2014–2019), renombramiento a **Lumen (`XLM`)** (2015) y **Stroop** (`10⁻⁷` unidad mínima). | **`RocketCrest` (`AGQ02`):** homenaje directo al cohete clásico 2014. **Lumen Core** pectoral y reliquia **`Stroop Spark`** (`1×1` píxel especular simbólico en marco/reliquia). |
| **Consenso SCP (FBA)** | Protocolo de David Mazières basado en **Quorum Slices** (nodos confiables entrelazados) con cierres cada pocos segundos sin PoW. | **`Aura` `QuorumSlice` (`OrbitTicks`):** 4 nodos orbitales simétricos representando un slice de consenso. **`SplitHUD`:** óptica multi-nodo sincronizada; pulso `animated_svg` al ritmo de cierre de ledger. |
| **2019 · Strkey & Símbolo Orbital** | Rebrand de marzo 2019 al anillo geométrico minimalista; **SEP-23 `Strkey`** (`G...` cuentas, `S...` semillas, `C...` contratos, `M...` muxed). | **`OrbitalHalo` (`AGQ04`)** inspirado en el anillo orbital 2019; clasificación epigenética de origen en metadata (`Class-G Pilot` vs. `Class-C Forged`). |
| **2020–2023 · Stellar Quest Lore** | Aventuras de **Bee & Roscoe** buscando el **Golden Soroban** (ábaco dorado) en el templo *Squaktahune* frente a **Zebulon**, serie **`FCA00C`** (*Fast, Cheap & Out of Control*) y **Friendbot**. | **`Obelisk` + `Void Obsidian` (`AGQ08 Legend`):** homenaje al templo y al ábaco dorado. Variantes y atributos nominados con guiños developer: visor **`FCA00C`**, reliquia **`Abacus Bead`**, paletas con historia (*Roscoe Signal*, *Zebulon Sovereign*, *Golden Soroban*). |
| **2024 · Protocol 20–22 (Nace Soroban)** | Mainnet Soroban (Feb 2024, `CAP-46`), almacenamiento **`Temporary / Persistent / Instance`**, **TTL / State Archival** (`CAP-46-12`) y constructores nativos (`CAP-0058`, P22). | **Marco Epigenético = Escudo TTL / Archival Guard:** el marco `1px` simboliza la protección activa contra expiración de estado en Soroban (`OriginHUD` → `BronzeSeal` → `GoldSovereign`). |
| **2025–2026 · Parallel, ZK & Yardstick/Zipper** | **Protocol 23** (Sep 2025): ejecución paralela (`CAP-0063`) + evicción automática (`CAP-0062`). **Protocol 25** (Ene 2026): primitivas ZK **`BN254`** (`CAP-0074`) y **`Poseidon2`** (`CAP-0075`). **Protocol 26 *"Yardstick"*** (May 2026, TTL preciso `CAP-0078`) y **Protocol 27 *"Zipper"*** (delegación auth `CAP-0071`). | **`Quantum Holo` + `CyborgHull` (`AGQ05`/`AGQ08`):** estética criptográfica ZK (*Poseidon Prism*) y ejecución paralela; **`MythicAwakened`** como sello *Yardstick / Zipper* con marca de época/protocolo on-chain en atributos SEP-50. |

