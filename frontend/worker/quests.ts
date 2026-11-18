export type QuestBadgeId =
  | 'pioneer'
  | 'launcher'
  | 'shouter'
  | 'graduate'
  | 'og'
  | 'whale'
  | 'phoenix'
  | 'legend'

export interface QuestBadgeSpec {
  id: QuestBadgeId
  assetCode: string
  emoji: string
  title: string
  subtitle: string
  criteria: string
  imagePath: string
  tier: 'Bronze' | 'Silver' | 'Gold' | 'Mythic' | 'Genesis'
}

export const ASTROGATE_QUEST_BADGES: readonly QuestBadgeSpec[] = [
  {
    id: 'pioneer',
    assetCode: 'AGQ01',
    emoji: '🌊',
    title: 'Floodgate Pioneer',
    subtitle: 'Sorobits · 2014 Ledger Square',
    criteria: 'Fund a Stellar Soroban wallet on Testnet via Friendbot.',
    imagePath: '/badges/pioneer.png',
    tier: 'Bronze',
  },
  {
    id: 'launcher',
    assetCode: 'AGQ02',
    emoji: '🚀',
    title: 'Fair Launcher',
    subtitle: 'Sorobits · 2014 Rocket Delta',
    criteria: 'Launch a Fair-Flywheel v4.4 token on-chain.',
    imagePath: '/badges/launcher.png',
    tier: 'Silver',
  },
  {
    id: 'shouter',
    assetCode: 'AGQ03',
    emoji: '👑',
    title: 'Shout King',
    subtitle: 'Sorobits · SCP Sovereign',
    criteria: 'Burn tokens in Burn-to-Chat (ShoutEvent on Soroban).',
    imagePath: '/badges/shouter.png',
    tier: 'Gold',
  },
  {
    id: 'graduate',
    assetCode: 'AGQ04',
    emoji: '🎓',
    title: 'Soroswap Graduate',
    subtitle: 'Sorobits · 2019 Orbital Ring',
    criteria: 'Trade or launch a bonding curve that graduated to Soroswap.',
    imagePath: '/badges/graduate.png',
    tier: 'Mythic',
  },
  {
    id: 'og',
    assetCode: 'AGQ05',
    emoji: '🕶️',
    title: 'Early OG',
    subtitle: 'Sorobits · FCA00C 3D Optics',
    criteria: 'Hold at least 1 AstroGate ecosystem token in your wallet.',
    imagePath: '/badges/og.png',
    tier: 'Silver',
  },
  {
    id: 'whale',
    assetCode: 'AGQ06',
    emoji: '🐳',
    title: 'Curve Trader',
    subtitle: 'Sorobits · Abyssal Circle',
    criteria: 'Execute at least 1 buy or sell trade on AstroGate curves.',
    imagePath: '/badges/whale.png',
    tier: 'Gold',
  },
  {
    id: 'phoenix',
    assetCode: 'AGQ07',
    emoji: '🔥',
    title: 'Burn Guardian',
    subtitle: 'Sorobits · Burn Phoenix',
    criteria: 'Crown a King Shout (>= 5,000 tokens) or trigger a supply burn.',
    imagePath: '/badges/phoenix.png',
    tier: 'Mythic',
  },
  {
    id: 'legend',
    assetCode: 'AGQ08',
    emoji: '✨',
    title: 'Genesis Legend',
    subtitle: 'Sorobits · Golden Soroban',
    criteria: 'Unlock 5+ Season 1 badges including Soroswap Graduate.',
    imagePath: '/badges/legend.png',
    tier: 'Genesis',
  },
] as const

export interface QuestProgressSummary {
  accountId: string
  funded: boolean
  unlocked: Record<QuestBadgeId, boolean>
  unlockedCount: number
  launchedCount: number
  shoutCount: number
  graduatedCount: number
  swapCount: number
  assetCount: number
  kingBurnCount: number
  sorobitsIds?: number[]
  sorobitsBalance?: number
}

export function computeQuestSummary(input: {
  accountId: string
  funded: boolean
  launchedCount: number
  shoutCount: number
  graduatedCount: number
  swapCount?: number
  assetCount?: number
  ecosystemTokenCount?: number
  kingBurnCount?: number
}): QuestProgressSummary {
  const swapCount = input.swapCount ?? 0
  const assetCount = input.assetCount ?? 0
  const ecosystemTokenCount = input.ecosystemTokenCount
  const kingBurnCount = input.kingBurnCount ?? 0

  const hasEcosystemAsset =
    ecosystemTokenCount !== undefined
      ? ecosystemTokenCount > 0
      : assetCount > 0

  const unlocked: Record<QuestBadgeId, boolean> = {
    pioneer: input.funded,
    launcher: input.launchedCount > 0,
    shouter: input.shoutCount > 0,
    graduate: input.graduatedCount > 0,
    og: hasEcosystemAsset || input.launchedCount > 0 || swapCount > 0,
    whale: swapCount > 0 || input.graduatedCount > 0,
    phoenix: kingBurnCount > 0,
    legend: false,
  }

  const baseCount = Object.values(unlocked).filter(Boolean).length
  unlocked.legend = baseCount >= 5 && unlocked.graduate

  const unlockedCount = Object.values(unlocked).filter(Boolean).length
  return {
    accountId: input.accountId,
    funded: input.funded,
    unlocked,
    unlockedCount,
    launchedCount: input.launchedCount,
    shoutCount: input.shoutCount,
    graduatedCount: input.graduatedCount,
    swapCount,
    assetCount,
    kingBurnCount,
  }
}

export interface PilotTelegramPerks {
  chatTitle: string
  sprintMultiplier: string
  feedPriority: boolean
  vipAlphaAccess: boolean
}

/** Maps unlocked Sorobits NFTs & Season-1 Quests to Telegram chat & Launchpad perks. */
export function computePilotPerks(
  progress: QuestProgressSummary,
): PilotTelegramPerks {
  const u = progress.unlocked
  let chatTitle = '🌑 Astro Explorer'
  if (u.legend) chatTitle = '✨ Genesis Legend'
  else if (u.graduate) chatTitle = '🎓 Soroswap Graduate'
  else if (u.phoenix || u.shouter) chatTitle = '👑 Shout Sovereign'
  else if (u.launcher) chatTitle = '🚀 Fair Architect'
  else if (u.pioneer) chatTitle = '🌊 Floodgate Pioneer'

  const multiplierNum =
    1 +
    (u.og ? 0.15 : 0) +
    (u.shouter ? 0.2 : 0) +
    (u.graduate ? 0.25 : 0) +
    (u.legend ? 0.4 : 0)

  return {
    chatTitle,
    sprintMultiplier: `${multiplierNum.toFixed(2).replace(/\.00$/, '.0')}x`,
    feedPriority: u.launcher || u.graduate || u.legend,
    vipAlphaAccess: u.graduate || u.phoenix || u.legend,
  }
}
