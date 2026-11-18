import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Resolves STELLAR_SECRET from the process environment or the local developer
 * credentials file (~/.secrets/astrogate/developer-accounts.env).
 * Never logs or echoes secret contents.
 */
export function loadStellarSecret() {
  const fromEnv = process.env.STELLAR_SECRET?.trim()
  if (fromEnv) return { secret: fromEnv, source: 'env' }

  const envPath = join(homedir(), '.secrets', 'astrogate', 'developer-accounts.env')
  if (!existsSync(envPath)) return { secret: null, source: null }

  const content = readFileSync(envPath, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:export\s+)?STELLAR_SECRET=(.+)$/)
    if (!match) continue
    const value = match[1].trim().replace(/^['"]|['"]$/g, '')
    if (value) return { secret: value, source: 'local-env-file' }
  }
  return { secret: null, source: null }
}
