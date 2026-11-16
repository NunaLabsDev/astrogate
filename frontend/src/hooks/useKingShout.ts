import { useQuery } from '@tanstack/react-query'
import { fetchKingShout, type ShoutRecord } from '../lib/token'

/**
 * Active pinned King Shout (`>= 1,000` burned tokens) for a token.
 */
export function useKingShout(tokenId: string | null) {
  return useQuery({
    queryKey: ['king-shout', tokenId],
    queryFn: async (): Promise<ShoutRecord | null> =>
      fetchKingShout(tokenId as string),
    enabled: Boolean(tokenId),
    staleTime: 15_000,
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
    retry: 1,
  })
}
