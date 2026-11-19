import { DEFAULT_SOROBAN_INCLUSION_FEE } from './network'

export { DEFAULT_SOROBAN_INCLUSION_FEE }

const pendingByAccount = new Map<string, Promise<unknown>>()

/**
 * Serializes state-changing Soroban transactions per signer public key so
 * back-to-back UI actions never race on Stellar account sequence numbers.
 */
export function enqueueAccountTx<T>(
  publicKey: string | undefined,
  task: () => Promise<T>,
): Promise<T> {
  const key = (publicKey ?? '').trim() || '__anonymous__'
  const prev = pendingByAccount.get(key) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(task)
  const settled = next.then(
    () => {
      if (pendingByAccount.get(key) === settled) {
        pendingByAccount.delete(key)
      }
    },
    () => {
      if (pendingByAccount.get(key) === settled) {
        pendingByAccount.delete(key)
      }
    },
  )
  pendingByAccount.set(key, settled)
  return next
}
