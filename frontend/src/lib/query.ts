import type { QueryClient } from '@tanstack/react-query'

/**
 * Invalidates all queries affected by a token state change (transfer, burn, mint, LP, or swap):
 * token balances, metadata/supply, events, Soroswap pool reserves, LP position/burn state, and XLM balances.
 */
export async function invalidateTokenData(
  queryClient: QueryClient,
  tokenId: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['token-balance', tokenId] }),
    queryClient.invalidateQueries({ queryKey: ['token-info', tokenId] }),
    queryClient.invalidateQueries({ queryKey: ['token-events', tokenId] }),
    queryClient.invalidateQueries({ queryKey: ['launch-curve', tokenId] }),
    queryClient.invalidateQueries({ queryKey: ['soroswap-pool', tokenId] }),
    queryClient.invalidateQueries({ queryKey: ['lp-position', tokenId] }),
    queryClient.invalidateQueries({ queryKey: ['lp-burn'] }),
    queryClient.invalidateQueries({ queryKey: ['xlm-balance'] }),
    queryClient.invalidateQueries({ queryKey: ['token-list'], refetchType: 'none' }),
  ])
}
