/**
 * Regenera los bindings TypeScript de los contratos que usa el frontend.
 *
 * - Para los contratos propios (`AstroToken`, `AstroLaunchpad`, `Sorobits`), usa
 *   directamente los WASM compilados en `../target/wasm32v1-none/release/` para
 *   incluir siempre la interfaz exacta más reciente (offline y determinista).
 * - Para Soroswap / XLM SAC lee los IDs de `testnet` desde `src/lib/network.ts`.
 *
 * Uso: npm run bindings
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { patchBindings } from './patch-bindings.mjs'

const network = readFileSync('src/lib/network.ts', 'utf8')

/** Lee una propiedad `key: '...'` dentro de `src/lib/network.ts`. */
function presetValue(key) {
  const value = network.match(new RegExp(`${key}:\\s*'([^']+)'`))?.[1]
  if (!value) {
    console.error(`No se encontró ${key} en src/lib/network.ts`)
    process.exit(1)
  }
  return value
}

const CONTRACTS = [
  {
    wasm: '../target/wasm32v1-none/release/astro_token.wasm',
    name: 'AstroToken',
    out: 'src/contracts',
  },
  {
    wasm: '../target/wasm32v1-none/release/astro_launchpad_contract.wasm',
    name: 'AstroLaunchpad',
    out: 'src/contracts/launchpad',
  },
  {
    wasm: '../target/wasm32v1-none/release/astro_sorobits_contract.wasm',
    name: 'Sorobits',
    out: 'src/contracts/sorobits',
  },
  {
    id: presetValue('soroswapRouter'),
    name: 'SoroswapRouter',
    out: 'src/contracts/soroswap-router',
  },
  {
    id: presetValue('soroswapFactory'),
    name: 'SoroswapFactory',
    out: 'src/contracts/soroswap-factory',
  },
  {
    // El spec del par es común a todos los pares (mismo wasm); el client se
    // construye con el contractId de cada par en runtime.
    id: 'CA32TMZ2AODXI7K7B6T2YPZR52HJKFCY5GT2DNHMOL326DLSNPX55BUP',
    name: 'SoroswapPair',
    out: 'src/contracts/soroswap-pair',
  },
  {
    id: presetValue('xlmSac'),
    name: 'XlmSac',
    out: 'src/contracts/xlm-sac',
  },
]

for (const contract of CONTRACTS) {
  const targetLabel = contract.wasm ?? contract.id
  console.log(`\n== ${contract.name} (${targetLabel}) ==`)
  const targetArgs = contract.wasm
    ? ['--wasm', contract.wasm]
    : ['--contract-id', contract.id, '--network', 'testnet']
  execFileSync(
    './node_modules/.bin/stellar-contract-bindings-typescript',
    [
      ...targetArgs,
      '--output-dir',
      contract.out,
      '--contract-name',
      contract.name,
      '--overwrite',
    ],
    { stdio: 'inherit' },
  )

  // El generador deja los .ts dentro de `src/`; los movemos al nivel del output.
  const generated = join(contract.out, 'src')
  if (existsSync(generated)) {
    for (const file of ['client.ts', 'types.ts', 'index.ts']) {
      renameSync(join(generated, file), join(contract.out, file))
    }
    rmSync(generated, { recursive: true, force: true })
  }
  for (const file of ['package.json', 'tsconfig.json']) {
    rmSync(join(contract.out, file), { force: true })
  }

  patchBindings(contract.out)
}

console.log('\nBindings listos')
