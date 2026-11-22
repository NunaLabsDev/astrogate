# Release checklist — AstroGate testnet

Este documento es para publicar el frontend en Cloudflare y verificar el flujo
completo. **Solo testnet.** No usar fondos reales.

## 0. Precondiciones

- [ ] `stellar --version` funciona (CLI 28.x).
- [ ] `node`/`npm` disponibles y `frontend/node_modules` instalado con `npm ci`.
- [ ] `wrangler` autenticado en la cuenta correcta: `npx wrangler whoami`.
- [ ] Rama aprobada y PR revisado; no publicar desde una rama sin revisar.
- [ ] `origin/main` no es el monorepo legacy (si lo es, decidir la base antes
      de hablar de “producción”; no forzar `main`).

## 1. Gates locales obligatorios

```bash
cd frontend
npm ci
npm run check
```

Debe pasar: build + lint + tests + smoke SSR + `verify:pwa`.

```bash
cargo test -p astro-token
```

Opcional, con red y sin secretos:

```bash
cd frontend
npm run verify:discovery
npm run verify:token-events
npm run verify:demo
```

`verify:demo` crea cuentas nuevas con Friendbot y ejecuta crear token,
liquidez, venta, compra XLM→token, mint y burn. No imprime semillas.

## 2. Construir y desplegar

```bash
cd frontend
npm run check
npx wrangler@latest whoami
npm run deploy:worker
npm run deploy
```

- El Worker está definido en `frontend/wrangler.jsonc` (`astrogate-stellar`, con `workers_dev: false`, `observability`, KV `ASTRO_KV`, AI y cron `*/2 * * * *`).
- Cloudflare Pages (`https://astrogate.pages.dev`) sirve `dist/` como assets estáticos + SPA fallback y enruta `/telegram/webhook`, `/api/*`, `/mcp`, `/openapi.json` y `/health` mediante `frontend/functions/` hacia `astrogate-stellar` vía Service Binding (`ASTROW`).
- No hay variables secretas en el frontend; los secretos (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`) residen exclusivamente en el Worker `astrogate-stellar`.

## 3. Verificación post-deploy

Con la URL unificada (`https://astrogate.pages.dev`):

```bash
URL="https://astrogate.pages.dev"
for path in / /sw.js /manifest.webmanifest /health /api/v1/health /openapi.json \
  /token/CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE; do
  curl -sS -o /dev/null -w "%{http_code} $path\n" "$URL$path"
done
```

- [ ] Visitar `/` en navegador externo muestra únicamente `TelegramLandingGate` con enlaces internos a `@AstroGateSorobanBot` (sin cargar `MiniAppShell` ni UI de trading), mientras `/sw.js`, `/manifest.webmanifest`, `/health`, `/api/v1/health`, `/.well-known/stellar.toml`, `/telegram/*.png` y `/openapi.json` devuelven `200`.
- [ ] `POST https://astrogate.pages.dev/api/telegram/session` sin `initData` válido devuelve `401`; `POST /api/telegram/pulse` sin `X-Telegram-Init-Data` devuelve `401` (y `403` ante origen no permitido).
- [ ] `POST https://astrogate.pages.dev/telegram/webhook` sin secreto devuelve `401` (y `getWebhookInfo` apunta a `https://astrogate.pages.dev/telegram/webhook` sin errores).
- [ ] `index.html` referencia el hash de assets del build actual (`dist/index.html` sin `modulepreload` de `vendor-stellar-*`).
- [ ] `/sw.js` responde `Cache-Control: no-cache`, tiene `Service-Worker-Allowed: /` y hace bypass en `/api/*`, `/mcp`, `/openapi.json`, `/health` y `/telegram/webhook`.
- [ ] Headers: CSP (`frame-ancestors https://web.telegram.org https://*.telegram.org;` sin `'self'`), `X-Content-Type-Options`, `Referrer-Policy`, HSTS y `Permissions-Policy`.
- [ ] El manifest tiene nombre, `start_url`, iconos 192/512 y `display`.
- [ ] El service worker no incluye RPC/Horizon/relays/API en el precache.

Flujo manual dentro de Telegram Mini App (`@AstroGateSorobanBot`, idealmente dos cuentas):

- [ ] Abrir `@AstroGateSorobanBot` en móvil/desktop y verificar inicio de sesión HMAC vía `/api/telegram/session`.
- [ ] Activar modo prueba; crear 3 cuentas; cambiar de usuario.
- [ ] Crear token (`launch_fair`): comprobar 10,000,000 supply fijo (`cap`),
      split Fair-Flywheel v4.5 (`66%` curva virtual `1,000 vXLM → 1,000 XLM`, `33%` Soroswap DEX con LP bloqueado 7 años en contrato,
      `0.3%` Creator 15d post-grad vesting, `0.4%` Jackpots `+5K / +10K` en escrow hasta graduación + `+25K`, `0.3%` Dev Ecosystem) y ownership renunciado.
      Al graduar a 1,000 XLM: LP bloqueados 7 años en el Launchpad (`reclaim_expired_lp` después) y cobro de jackpots con `claim_jackpot`.
- [ ] Vender token → XLM; comprobar mínimo, slippage, share del pool e impacto.
- [ ] Comprar token con XLM; comprobar actualización de balance XLM y token.
- [ ] Burn-to-Chat (`burn_shout`), transferir o quemar token; comprobar descenso
      de `total_supply`.
- [ ] Añadir y retirar liquidez manual (con LP propio); comprobar LP quemados y
      ambos activos devueltos.
- [ ] Abrir deep links en `@AstroGateSorobanBot?start=<tokenId|market|sorobits|create>` y verificar envío de alertas únicamente a `@AstroGateFeed` (nunca `@AstroGateCommunity`).
- [ ] Desbloquear Hot Wallet con Biometría/PIN y sincronización en `Telegram.WebApp.CloudStorage`.

## 4. Rollback

```bash
cd frontend
npx wrangler@latest deployments list
npx wrangler@latest rollback <deployment-id>
```

Mantén el deployment anterior identificado antes de publicar. Si el problema es
de datos on-chain, el rollback del frontend no revierte transacciones: documenta
el hash y actúa en testnet.

## 5. Incidente

- [ ] Revocar cualquier token/credencial expuesta.
- [ ] Volver al deployment estable.
- [ ] Abrir un Security Advisory privado si hay impacto de seguridad.
- [ ] Registrar run record: commit, hora, URL, modelo/agente, checks y resultado.

## Nunca

- `git push --force` a `main`/`release`.
- Publicar sin `npm run check` verde.
- Commitear semillas, tokens de Cloudflare/GitHub o `.env`.
- Usar el despliegue de testnet con claves o fondos de mainnet sin auditoría externa completa.
