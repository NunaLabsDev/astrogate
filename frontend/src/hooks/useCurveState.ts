import { useQuery } from '@tanstack/react-query'
import { fetchCurveState, type CurveState } from '../lib/token'

/**
 * Live Fair-Flywheel v4 bonding curve, graduation, Proof-of-Burn vault,
 * and creator 15-day vesting state read from Launchpad storage.
 */
export function useCurveState(tokenId: string | null) {
  return useQuery({
    queryKey: ['launch-curve', tokenId],
    queryFn: async (): Promise<CurveState | null> =>
      fetchCurveState(tokenId as string),
    enabled: Boolean(tokenId),
    staleTime: 10_000,
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
  })
}
