import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidateTokenData } from './query'

describe('invalidateTokenData', () => {
  it('invalidates all live token, pool, LP, and XLM balance queries without stale legacy keys', async () => {
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries').mockResolvedValue()
    const tokenId = 'CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE'

    await invalidateTokenData(client, tokenId)

    const keys = spy.mock.calls.map((call) => call[0]?.queryKey)
    expect(keys).toContainEqual(['token-balance', tokenId])
    expect(keys).toContainEqual(['token-info', tokenId])
    expect(keys).toContainEqual(['token-events', tokenId])
    expect(keys).toContainEqual(['soroswap-pool', tokenId])
    expect(keys).toContainEqual(['lp-position', tokenId])
    expect(keys).toContainEqual(['lp-burn'])
    expect(keys).toContainEqual(['xlm-balance'])
    expect(keys).not.toContainEqual(['demo-xlm-balances'])
  })
})
