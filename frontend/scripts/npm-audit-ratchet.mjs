/**
 * Ratchet de `npm audit`: bloquea REGRESIONES de vulnerabilidades.
 *
 * El baseline actual es transitivo de los módulos de wallet de
 * `@creit.tech/stellar-wallets-kit` (@hot-wallet/sdk → near-js/elliptic,
 * @reown/appkit → zod, etc.) y no tiene fix sin downgrade del kit. Cuando el
 * kit suelte una versión limpia, BAJAR `baseline` en ci.yml y aquí.
 *
 * Uso: node scripts/npm-audit-ratchet.mjs [baseline=29]
 * (el CI pasa el baseline también por env `AUDIT_BASELINE` y techo high `AUDIT_MAX_HIGH`).
 */
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const argBaseline = Number(process.argv[2] ?? '')
const envBaseline = Number(process.env.AUDIT_BASELINE ?? '')
const baseline = Number.isFinite(argBaseline) && argBaseline > 0
  ? argBaseline
  : Number.isFinite(envBaseline) && envBaseline > 0
    ? envBaseline
    : 29
const rawMaxHigh = (process.env.AUDIT_MAX_HIGH ?? '').trim()
const parsedMaxHigh = Number(rawMaxHigh)
const MAX_HIGH =
  rawMaxHigh !== '' && Number.isFinite(parsedMaxHigh) && parsedMaxHigh >= 0
    ? parsedMaxHigh
    : 11

const result = spawnSync('npm', ['audit', '--json'], {
  encoding: 'utf8',
  // npm audit sale con 1 cuando hay vulnerabilidades: no es un fallo aquí.
  stdio: ['ignore', 'pipe', 'ignore'],
  maxBuffer: 16 * 1024 * 1024,
})

let audit
try {
  audit = JSON.parse(result.stdout)
} catch {
  console.error('✗ npm audit --json devolvió salida no parseable (¿sin red?)')
  process.exit(1)
}

if (!audit || typeof audit !== 'object' || audit.error || !audit.metadata?.vulnerabilities) {
  console.error('✗ npm audit --json falló o no incluyó metadata.vulnerabilities (fail-closed)')
  process.exit(1)
}

const metadata = audit.metadata.vulnerabilities
const counts = [
  'critical',
  'high',
  'moderate',
  'low',
].map((level) => Number(metadata[level] ?? 0))
if (counts.some((n) => !Number.isFinite(n))) {
  console.error('✗ npm audit devolvió contadores inválidos')
  process.exit(1)
}
const total = counts.reduce((sum, n) => sum + n, 0)
const [criticalCount, highCount] = counts

console.log(
  `Vulnerabilidades npm audit: ${total} (crit ${counts[0]} · high ${highCount} [max ${MAX_HIGH}] · mod ${counts[2]} · low ${counts[3]}) — baseline ${baseline}`,
)

if (criticalCount > 0) {
  console.error(
    `✗ Fallo crítico de seguridad: se detectaron ${criticalCount} vulnerabilidades críticas en npm audit.`,
  )
  process.exit(1)
}

if (highCount > MAX_HIGH) {
  console.error(
    `✗ Se superó el techo de vulnerabilidades HIGH (${highCount} > ${MAX_HIGH}).`,
  )
  process.exit(1)
}

if (total > baseline) {
  console.error(
    '✗ Se superó el baseline de vulnerabilidades: revisa si una nueva dependencia añadió transitivos.',
  )
  process.exit(1)
}
if (total < baseline) {
  console.log(
    `ℹ Aviso: las vulnerabilidades bajaron de ${baseline} a ${total}. Se puede reducir el baseline en ci.yml y scripts/npm-audit-ratchet.mjs.`,
  )
}
console.log('✓ npm audit dentro del baseline')
