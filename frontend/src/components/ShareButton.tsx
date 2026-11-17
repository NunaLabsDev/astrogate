import { BRAND } from '../lib/brand'
import { useCopy } from '../hooks/useCopy'
import { getTelegramWebApp, shareToTelegram } from '../lib/telegram'

type Props = {
  text: string
  url: string
  label?: string
  compact?: boolean
}

export function ShareButton({ text, url, label = 'Share 🎉', compact = false }: Props) {
  const { copied, copy } = useCopy()

  async function onShare() {
    if (getTelegramWebApp()) {
      shareToTelegram(text, url)
      return
    }
    const nav = typeof navigator !== 'undefined' ? navigator : undefined
    if (nav?.share) {
      try {
        await nav.share({ title: `${BRAND.name} ${BRAND.emoji}`, text, url })
        return
      } catch {
        return
      }
    }
    if (nav?.clipboard) {
      await copy(`${text} ${url}`)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void onShare()}
      className={
        compact
          ? 'h-7 shrink-0 rounded-lg border border-emerald-800 bg-emerald-900/30 px-2 py-0.5 text-xs font-medium text-emerald-300 hover:border-emerald-600'
          : 'min-h-[44px] rounded-lg border border-emerald-800 bg-emerald-900/30 px-3 py-2 text-xs font-medium text-emerald-300 hover:border-emerald-600'
      }
    >
      {copied ? 'Link copied ✓' : label}
    </button>
  )
}
