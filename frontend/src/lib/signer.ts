import { createAstroConnectClient } from '@astrowallet/connect'
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit'
import type { Signer } from '@stellar/stellar-sdk/contract'
import { isValidStellarAddress } from './address'
import { BRAND } from './brand'
import { getAstroGateBotUsername } from './ecosystem'
import { NETWORK_PASSPHRASE } from './network'
import { openTelegramDeepLink } from './telegram'

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
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const client = createAstroConnectClient({
        apiBaseUrl: origin,
        requestsPathPrefix: '/api/v1/wallet/connect/requests',
        app: {
          name: BRAND.name,
          botUsername: getAstroGateBotUsername(),
          ...(origin ? { origin } : {}),
        },
        openLinkFn: openTelegramDeepLink,
      })
      const result = await client.signTransaction(xdr, {
        submit: false,
        sourceAddress: address,
        humanSummary: `Sign ${BRAND.name} Soroban transaction`,
        timeoutMs: 180_000,
      })
      if (!result.signedXdr) {
        throw new Error('AstroWallet did not return a signed XDR.')
      }
      return {
        signedTxXdr: result.signedXdr,
        signerAddress: result.address ?? address,
      }
    },
    signAuthEntry: () => {
      throw new Error(
        'Direct auth-entry signing is handled inside full Clear-Sign transactions in AstroWallet.',
      )
    },
  }
}
