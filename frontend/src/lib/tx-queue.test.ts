import { describe, expect, it } from 'vitest'
import { enqueueAccountTx } from './tx-queue'

describe('enqueueAccountTx sequence serialization', () => {
  it('serializes concurrent transactions for the same Stellar account while running distinct accounts independently', async () => {
    const acctA = 'GDQT2KMQ5I2EFDK3WG42YBHRIC4B7OXL7K2G3IC2Z6LPTJEEOMXD7NQE'
    const acctB = 'GB6CISIU2PAG7MVCR4HKA27VY5OBBJ4P2L5IDEOH7UL34TU66OOFCNZA'
    const events: string[] = []
    let activeForA = 0
    let maxConcurrentForA = 0

    const p1 = enqueueAccountTx(acctA, async () => {
      activeForA += 1
      maxConcurrentForA = Math.max(maxConcurrentForA, activeForA)
      events.push('A1-start')
      await new Promise((r) => setTimeout(r, 25))
      events.push('A1-end')
      activeForA -= 1
      return 1
    })

    const p2 = enqueueAccountTx(acctA, async () => {
      activeForA += 1
      maxConcurrentForA = Math.max(maxConcurrentForA, activeForA)
      events.push('A2-start')
      await new Promise((r) => setTimeout(r, 5))
      events.push('A2-end')
      activeForA -= 1
      return 2
    })

    const pB = enqueueAccountTx(acctB, async () => {
      events.push('B1')
      return 'b'
    })

    const [r1, r2, rB] = await Promise.all([p1, p2, pB])
    expect([r1, r2, rB]).toEqual([1, 2, 'b'])
    expect(maxConcurrentForA).toBe(1)
    expect(events.indexOf('A1-end')).toBeLessThan(events.indexOf('A2-start'))
    expect(events.indexOf('B1')).toBeLessThan(events.indexOf('A1-end'))
  })

  it('continues processing subsequent transactions after a failure', async () => {
    const acct = 'GDQT2KMQ5I2EFDK3WG42YBHRIC4B7OXL7K2G3IC2Z6LPTJEEOMXD7NQE'
    const first = enqueueAccountTx(acct, async () => {
      throw new Error('simulated RPC error')
    })
    await expect(first).rejects.toThrow('simulated RPC error')

    const second = await enqueueAccountTx(acct, async () => 'recovered')
    expect(second).toBe('recovered')
  })
})
