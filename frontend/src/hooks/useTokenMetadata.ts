import { useCallback, useMemo, useSyncExternalStore } from 'react'
import {
  DEFAULT_TOKEN_METADATA,
  getLocalTokenMetadata,
  subscribeTokenMetadata,
  type EnrichedTokenMetadata,
} from '../lib/token-metadata'

export function useTokenMetadata(tokenId: string | null | undefined): {
  data: EnrichedTokenMetadata | null
} {
  const getSnapshot = useCallback(
    () => (tokenId ? getLocalTokenMetadata(tokenId) : null),
    [tokenId],
  )
  const getServerSnapshot = useCallback(
    () => (tokenId ? DEFAULT_TOKEN_METADATA[tokenId] ?? null : null),
    [tokenId],
  )
  const data = useSyncExternalStore(
    subscribeTokenMetadata,
    getSnapshot,
    getServerSnapshot,
  )
  return useMemo(() => ({ data }), [data])
}
