export const MAX_RAW_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB
export const MAX_LOGO_UPLOAD_BYTES = 32_768 // 32 KB max compressed payload
export const LOGO_TARGET_SIZE = 128
export const DEFAULT_PUBLIC_ORIGIN = 'https://astrogate.pages.dev'

const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
])

const ALLOWED_EXTENSIONS = /\.(png|jpe?g|webp|gif)$/i

export interface CompressedLogoResult {
  dataUrl: string
  blob: Blob
  mimeType: string
  sha256: string
  width: number
  height: number
}

/**
 * Computes lowercase 64-char SHA-256 hex digest using WebCrypto for content-addressed logos.
 */
export async function computeSha256Hex(
  input: Uint8Array | ArrayBuffer,
): Promise<string> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer)
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}

/**
 * Validates that a selected logo file is a safe raster image within size limits.
 */
export function validateLogoFile(
  file: Pick<File, 'type' | 'size' | 'name'> | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!file) {
    return { ok: false, error: 'No image file selected.' }
  }
  const normalizedType = file.type.trim().toLowerCase()
  const hasAllowedType = normalizedType
    ? ALLOWED_IMAGE_TYPES.has(normalizedType)
    : ALLOWED_EXTENSIONS.test(file.name)
  if (!hasAllowedType) {
    return { ok: false, error: 'Use PNG, JPG, WebP, or GIF image format.' }
  }
  if (file.size <= 0) {
    return { ok: false, error: 'Image file is empty.' }
  }
  if (file.size > MAX_RAW_IMAGE_BYTES) {
    return { ok: false, error: 'Image exceeds 5 MB limit before compression.' }
  }
  return { ok: true }
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode selected image.'))
    img.src = src
  })
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality)
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Failed to encode compressed image preview.'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read compressed image preview.'))
    reader.readAsDataURL(blob)
  })
}

function extForMime(mime: string): 'webp' | 'png' | 'jpg' | 'gif' {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/gif') return 'gif'
  return 'webp'
}

/**
 * Center-crops and compresses any raster image in the browser to a lightweight
 * 128x128 WebP (with JPEG fallback) and computes its content-addressed SHA-256 digest.
 */
export async function compressImageFileToWebp(
  file: File,
  targetSize = LOGO_TARGET_SIZE,
): Promise<CompressedLogoResult> {
  const validation = validateLogoFile(file)
  if (!validation.ok) {
    throw new Error(validation.error)
  }
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new Error('Image compression requires a browser environment.')
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await loadImageElement(objectUrl)
    const naturalW = img.naturalWidth || targetSize
    const naturalH = img.naturalHeight || targetSize
    const cropSide = Math.min(naturalW, naturalH)
    const sx = Math.max(0, (naturalW - cropSide) / 2)
    const sy = Math.max(0, (naturalH - cropSide) / 2)

    const canvas = document.createElement('canvas')
    canvas.width = targetSize
    canvas.height = targetSize
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Canvas 2D context is unavailable.')
    }
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, sx, sy, cropSide, cropSide, 0, 0, targetSize, targetSize)

    const webpBlob = await canvasToBlob(canvas, 'image/webp', 0.84)
    const chosenBlob =
      webpBlob && webpBlob.type === 'image/webp'
        ? webpBlob
        : await canvasToBlob(canvas, 'image/jpeg', 0.86)

    if (!chosenBlob) {
      throw new Error('Browser could not compress image.')
    }

    const [dataUrl, buf] = await Promise.all([
      blobToDataUrl(chosenBlob),
      chosenBlob.arrayBuffer(),
    ])
    const sha256 = await computeSha256Hex(buf)
    return {
      dataUrl,
      blob: chosenBlob,
      mimeType: chosenBlob.type || 'image/webp',
      sha256,
      width: targetSize,
      height: targetSize,
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/**
 * Publishes a compressed token logo to AstroGate's content-addressed Worker store
 * (`/api/v1/logos`) and returns its immutable SHA-256 URL for `LaunchRecord.meta`
 * on Stellar Soroban (zero API keys, zero third-party pinning lock-in).
 */
export async function uploadTokenLogo(
  blob: Blob,
  options?: {
    sha256?: string
    endpoint?: string
    fallbackOrigin?: string
    fetchFn?: typeof fetch
  },
): Promise<string> {
  if (blob.size <= 0 || blob.size > MAX_LOGO_UPLOAD_BYTES) {
    throw new Error(
      `Compressed logo must be between 1 and ${MAX_LOGO_UPLOAD_BYTES} bytes.`,
    )
  }

  const buffer = await blob.arrayBuffer()
  const sha256 = options?.sha256 ?? (await computeSha256Hex(buffer))
  const contentType = blob.type || 'image/webp'
  const ext = extForMime(contentType)
  const fallbackOrigin = (
    options?.fallbackOrigin ?? DEFAULT_PUBLIC_ORIGIN
  ).replace(/\/+$/, '')
  const deterministicUrl = `${fallbackOrigin}/api/v1/logos/${sha256}.${ext}`

  const fetchImpl = options?.fetchFn ?? globalThis.fetch
  const candidates = options?.endpoint
    ? [options.endpoint]
    : ['/api/v1/logos', `${fallbackOrigin}/api/v1/logos`]

  for (const endpoint of candidates) {
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
          'X-Logo-Sha256': sha256,
        },
        body: buffer,
        signal:
          typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
            ? AbortSignal.timeout(10_000)
            : undefined,
      })
      if (!res.ok) continue
      const json = (await res.json()) as { ok?: boolean; url?: unknown }
      if (json.ok && typeof json.url === 'string' && json.url.startsWith('https://')) {
        return json.url
      }
      if (json.ok) {
        return deterministicUrl
      }
    } catch {
      // Try next endpoint or deterministic fallback URL
    }
  }

  return deterministicUrl
}
