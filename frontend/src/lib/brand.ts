/**
 * Single source of truth for app branding.
 * Updating here rebrands the header, hero, index.html, and manifest.
 *
 * Name combination:
 * Unites the technical name from stellar-core `Floodgate` (src/overlay/Floodgate.cpp)
 * with the iconic Stellar meme token `Astro` -> **AstroGate** 🌊🚀.
 *
 * Genesis/Flagship Meme Token: ASTRO ($ASTRO), deployed and verified on Soroswap testnet.
 */
import { NETWORK_NAME } from './network'

export const BRAND = {
  name: 'AstroGate',
  shortName: 'AstroGate',
  tokenName: 'ASTRO',
  emoji: '🌊🚀',
  tagline: 'Open the Floodgates',
  taglineEn: 'Open the Floodgates',
  hero: 'Fair Meme Launchpad + AMM on Stellar',
  description:
    `Launch Fair-Flywheel v4.5 tokens with 7-year Soroswap LP locks, escrowed 40K jackpots & on-chain Sorobits NFTs on Stellar ${NETWORK_NAME} — exclusively inside Telegram.`,
  manifestDescription:
    `AstroGate — Fair-Flywheel v4.5 Launchpad, Soroswap AMM & Sorobits NFTs on Stellar ${NETWORK_NAME}.`,
  provenance:
    'Union of stellar-core Floodgate (src/overlay/Floodgate.cpp) and Astro meme',
} as const
