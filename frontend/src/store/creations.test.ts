import { beforeEach, describe, expect, it } from 'vitest'
import {
  CREATED_TOKENS_STORAGE_KEY,
  loadTokens,
  useCreatedTokens,
} from './creations'
import { clearStorageMemoryFallbackForTests, writeStorageJson } from '../lib/storage'

const TOKEN_A = 'CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE'
const TOKEN_B = 'CA32TMZ2AODXI7K7B6T2YPZR52HJKFCY5GT2DNHMOL326DLSNPX55BUP'
const LEGACY_KEY = CREATED_TOKENS_STORAGE_KEY.replace(/^astrogate\./, 'floodgate.')

describe('useCreatedTokens', () => {
  beforeEach(() => {
    clearStorageMemoryFallbackForTests()
    useCreatedTokens.setState({ tokens: [] })
    writeStorageJson(CREATED_TOKENS_STORAGE_KEY, [])
    writeStorageJson(LEGACY_KEY, null)
  })

  it('adds and removes tokens including name and creator scope', () => {
    const { add, remove } = useCreatedTokens.getState()
    const creator = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

    add({ id: TOKEN_A, symbol: 'ASTRO', name: 'Astro Coin', creator, decimals: 7 })
    expect(useCreatedTokens.getState().tokens).toHaveLength(1)
    expect(useCreatedTokens.getState().tokens[0].id).toBe(TOKEN_A)
    expect(useCreatedTokens.getState().tokens[0].name).toBe('Astro Coin')
    expect(useCreatedTokens.getState().tokens[0].creator).toBe(creator)

    remove(TOKEN_A)
    expect(useCreatedTokens.getState().tokens).toHaveLength(0)
  })

  it('transparently migrates legacy floodgate.created-tokens.v1', () => {
    writeStorageJson(LEGACY_KEY, [
      { id: TOKEN_B, symbol: 'LEGACY', decimals: 7, createdAt: 12345 },
    ])
    // Ensure astrogate key is absent initially so migration occurs
    clearStorageMemoryFallbackForTests()
    writeStorageJson(LEGACY_KEY, [
      { id: TOKEN_B, symbol: 'LEGACY', decimals: 7, createdAt: 12345 },
    ])

    const loaded = loadTokens()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe(TOKEN_B)
    expect(loaded[0].symbol).toBe('LEGACY')
  })
})
