import { describe, expect, it, vi } from 'vitest'
import {
  computeSha256Hex,
  DEFAULT_PUBLIC_ORIGIN,
  MAX_LOGO_UPLOAD_BYTES,
  MAX_RAW_IMAGE_BYTES,
  uploadTokenLogo,
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

  it('computes deterministic 64-char SHA-256 hex digest for logo bytes', async () => {
    const hashA = await computeSha256Hex(new TextEncoder().encode('astro-logo'))
    const hashB = await computeSha256Hex(new TextEncoder().encode('astro-logo'))
    expect(hashA).toMatch(/^[0-9a-f]{64}$/)
    expect(hashA).toBe(hashB)
  })

  it('uploads content-addressed logo to Worker /api/v1/logos without client API keys', async () => {
    const payload = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
    const sha = await computeSha256Hex(payload)
    const expectedUrl = `${DEFAULT_PUBLIC_ORIGIN}/api/v1/logos/${sha}.webp`

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, sha256: sha, url: expectedUrl }),
    })
    const blob = new Blob([payload], { type: 'image/webp' })

    const url = await uploadTokenLogo(blob, {
      endpoint: '/api/v1/logos',
      fetchFn: fetchMock as unknown as typeof fetch,
    })

    expect(url).toBe(expectedUrl)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe('/api/v1/logos')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Logo-Sha256']).toBe(sha)
  })

  it('throws an explicit error when Worker logo upload endpoint is unreachable', async () => {
    const payload = new TextEncoder().encode('offline-logo-bytes')
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    const blob = new Blob([payload], { type: 'image/webp' })

    await expect(
      uploadTokenLogo(blob, {
        fetchFn: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow('network down')
  })

  it('rejects compressed logos larger than MAX_LOGO_UPLOAD_BYTES', async () => {
    const oversized = new Blob([new Uint8Array(MAX_LOGO_UPLOAD_BYTES + 1)], {
      type: 'image/webp',
    })
    await expect(uploadTokenLogo(oversized)).rejects.toThrow('Compressed logo must be')
  })
})
