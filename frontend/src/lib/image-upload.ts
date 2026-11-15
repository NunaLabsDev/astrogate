export const MAX_RAW_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB
export const LOGO_TARGET_SIZE = 128
export const PINATA_PIN_FILE_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS'
export const PINATA_GATEWAY_BASE = 'https://gateway.pinata.cloud/ipfs/'

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
  width: number
  height: number
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

/**
 * Center-crops and compresses any raster image in the browser to a lightweight
 * 128x128 WebP (with JPEG fallback) ready for local preview or IPFS pinning.
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

    const dataUrl = await blobToDataUrl(chosenBlob)
    return {
      dataUrl,
      blob: chosenBlob,
      mimeType: chosenBlob.type || 'image/webp',
      width: targetSize,
      height: targetSize,
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export function isPinataConfigured(
  env: Record<string, unknown> = import.meta.env as Record<string, unknown>,
): boolean {
  const raw = env.VITE_PINATA_JWT
  return typeof raw === 'string' && raw.trim().length > 0
}

/**
 * Optionally pins a compressed logo Blob to Pinata IPFS when `VITE_PINATA_JWT`
 * is configured. Returns `null` when running in zero-config / keyless mode.
 */
export async function uploadImageToIpfsIfConfigured(
  blob: Blob,
  fileName = 'token-logo.webp',
  options?: { jwt?: string; fetchFn?: typeof fetch },
): Promise<string | null> {
  const envJwt = (import.meta.env as Record<string, unknown>).VITE_PINATA_JWT
  const jwt = (options?.jwt ?? (typeof envJwt === 'string' ? envJwt : '')).trim()
  if (!jwt) return null

  const form = new FormData()
  form.append('file', blob, fileName)

  const fetchImpl = options?.fetchFn ?? globalThis.fetch
  const res = await fetchImpl(PINATA_PIN_FILE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
    body: form,
    signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
      ? AbortSignal.timeout(15_000)
      : undefined,
  })

  if (!res.ok) {
    throw new Error(`IPFS upload failed (${res.status})`)
  }

  const json = (await res.json()) as { IpfsHash?: unknown }
  const cid = typeof json.IpfsHash === 'string' ? json.IpfsHash.trim() : ''
  if (!cid) {
    throw new Error('IPFS upload returned no CID.')
  }

  return `${PINATA_GATEWAY_BASE}${cid}`
}
