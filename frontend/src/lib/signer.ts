import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit'
import type { Signer } from '@stellar/stellar-sdk/contract'
import { isValidStellarAddress } from './address'
import { NETWORK_PASSPHRASE } from './network'
import { openTelegramDeepLink } from './telegram'
import { BRAND } from './brand'

function assertNetworkPassphrase(provided?: string): string {
  if (provided && provided !== NETWORK_PASSPHRASE) {
    throw new Error(
      'Transaction network passphrase does not match active AstroGate network.',
    )
  }
  return NETWORK_PASSPHRASE
}

/**
 * Envoltorio de la wallet (SEP-43) como `Signer` del SDK de Stellar.
 * `StellarWalletsKit` firma con la cuenta activa, por eso fijamos `address`.
 */
export function walletSigner(address: string): Signer {
  if (!isValidStellarAddress(address)) {
    throw new Error(`Invalid Stellar wallet address: ${address}`)
  }

  return {
    address,
    signTransaction: (xdr, opts) =>
      StellarWalletsKit.signTransaction(xdr, {
        networkPassphrase: assertNetworkPassphrase(opts?.networkPassphrase),
        address: signerAddress(address, opts?.address),
      }),
    signAuthEntry: (authEntry, opts) =>
      StellarWalletsKit.signAuthEntry(authEntry, {
        networkPassphrase: assertNetworkPassphrase(opts?.networkPassphrase),
        address: signerAddress(address, opts?.address),
      }),
  }
}

/**
 * El SDK puede pedir firmar con otra cuenta si el usuario cambió de wallet a
 * mitad de una transacción. Firmar con una cuenta distinta a la esperada
 * produciría auths inválidas; fallamos explícitamente y el usuario reconecta.
 */
function signerAddress(expected: string, provided?: string): string {
  if (provided && provided !== expected) {
    throw new Error(
      `Active wallet (${provided.slice(0, 6)}…${provided.slice(-4)}) does not match expected account (${expected.slice(0, 6)}…${expected.slice(-4)}). Please reconnect your wallet and try again.`,
    )
  }
  return expected
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Universal Clear-Sign delegator backed by AstroWallet (Pillar 1 AstroConnect v1).
 * Routes signing requests via AstroGate Worker proxy -> ASTROWALLET binding -> Clear-Sign sheet.
 */
export function astroWalletConnectSigner(address: string): Signer {
  if (!isValidStellarAddress(address)) {
    throw new Error(`Invalid Stellar wallet address: ${address}`)
  }

  return {
    address,
    signTransaction: async (xdr, opts) => {
      assertNetworkPassphrase(opts?.networkPassphrase)
      signerAddress(address, opts?.address)
      const xdrSha256 = await sha256Hex(xdr)
      const createRes = await fetch('/api/v1/wallet/connect/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sign_xdr',
          app: {
            name: BRAND.name,
            origin: typeof window !== 'undefined' ? window.location.origin : undefined,
          },
          payload: {
            unsignedXdr: xdr,
            xdrSha256,
            submit: false,
            humanSummary: `Sign ${BRAND.name} Soroban transaction`,
          },
        }),
      })
      const created = (await createRes.json().catch(() => ({}))) as {
        requestId?: string
        resultToken?: string
        deepLink?: string
        error?: string
      }
      if (!createRes.ok || !created.requestId || !created.resultToken) {
        throw new Error(created.error ?? 'Failed to initialize AstroWallet Clear-Sign session.')
      }
      if (created.deepLink) {
        openTelegramDeepLink(created.deepLink)
      }

      const deadline = Date.now() + 180_000
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        const pollRes = await fetch(`/api/v1/wallet/connect/requests/${created.requestId}`, {
          headers: { 'X-Connect-Token': created.resultToken },
        })
        if (!pollRes.ok) continue
        const poll = (await pollRes.json().catch(() => ({}))) as {
          status?: string
          result?: {
            signedXdr?: string
            address?: string
            reason?: string
          }
        }
        if (poll.status === 'approved' && poll.result?.signedXdr) {
          return {
            signedTxXdr: poll.result.signedXdr,
            signerAddress: poll.result.address ?? address,
          }
        }
        if (poll.status === 'rejected' || poll.status === 'expired') {
          throw new Error(
            poll.result?.reason ?? `AstroWallet signature ${poll.status}.`,
          )
        }
      }
      throw new Error('Timed out waiting for AstroWallet Clear-Sign approval.')
    },
    signAuthEntry: () => {
      throw new Error(
        'Direct auth-entry signing is handled inside full Clear-Sign transactions in AstroWallet.',
      )
    },
  }
}
