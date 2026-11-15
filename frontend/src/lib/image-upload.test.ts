import { describe, expect, it, vi } from 'vitest'
import {
  isPinataConfigured,
  MAX_RAW_IMAGE_BYTES,
  PINATA_GATEWAY_BASE,
  PINATA_PIN_FILE_URL,
  uploadImageToIpfsIfConfigured,
  validateLogoFile,
} from './image-upload'

describe('image-upload helpers', () => {
  it('validates allowed raster MIME types, extensions, and 5MB cap', () => {
    expect(validateLogoFile({ name: 'astro.png', type: 'image/png', size: 12_000 })).toEqual({
      ok: true,
    })
    expect(validateLogoFile({ name: 'astro.webp', type: '', size: 4_000 })).toEqual({
      ok: true,
    })

    const badSvg = validateLogoFile({ name: 'xss.svg', type: 'image/svg+xml', size: 1024 })
    expect(badSvg.ok).toBe(false)

    const empty = validateLogoFile({ name: 'empty.png', type: 'image/png', size: 0 })
    expect(empty.ok).toBe(false)

    const tooLarge = validateLogoFile({
      name: 'huge.jpg',
      type: 'image/jpeg',
      size: MAX_RAW_IMAGE_BYTES + 1,
    })
    expect(tooLarge.ok).toBe(false)
  })

  it('detects whether Pinata JWT env variable is configured', () => {
    expect(isPinataConfigured({})).toBe(false)
    expect(isPinataConfigured({ VITE_PINATA_JWT: '   ' })).toBe(false)
    expect(isPinataConfigured({ VITE_PINATA_JWT: 'jwt-token-value' })).toBe(true)
  })

  it('returns null gracefully when VITE_PINATA_JWT is unset', async () => {
    const fetchMock = vi.fn()
    const blob = new Blob(['webp-bytes'], { type: 'image/webp' })
    const url = await uploadImageToIpfsIfConfigured(blob, 'logo.webp', {
      jwt: '',
      fetchFn: fetchMock as unknown as typeof fetch,
    })
    expect(url).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('pins to Pinata IPFS and resolves HTTPS gateway URL when JWT is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ IpfsHash: 'QmTestCid123456' }),
    })
    const blob = new Blob(['webp-bytes'], { type: 'image/webp' })

    const url = await uploadImageToIpfsIfConfigured(blob, 'astro.webp', {
      jwt: 'secret-jwt',
      fetchFn: fetchMock as unknown as typeof fetch,
    })

    expect(url).toBe(`${PINATA_GATEWAY_BASE}QmTestCid123456`)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe(PINATA_PIN_FILE_URL)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-jwt')
  })

  it('surfaces non-OK HTTP errors cleanly on Pinata upload failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    })
    const blob = new Blob(['webp-bytes'], { type: 'image/webp' })

    await expect(
      uploadImageToIpfsIfConfigured(blob, 'astro.webp', {
        jwt: 'bad-jwt',
        fetchFn: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow('IPFS upload failed (401)')
  })
})
