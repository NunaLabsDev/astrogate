import type { PagesProxyEnv } from '../_proxy'

interface StellarTomlContext {
  request: Request
  env: PagesProxyEnv
  next: (input?: Request | string) => Promise<Response>
}

/**
 * SEP-1 stellar.toml endpoint for Cloudflare Pages:
 * delegates to the ASTROW worker when bound (for dynamic mainnet TOML) or
 * falls back to static `public/.well-known/stellar.toml`, always enforcing
 * `Access-Control-Allow-Origin: *` and `text/plain; charset=utf-8`.
 */
export async function onRequest(context: StellarTomlContext): Promise<Response> {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  const upstream = context.env.ASTROW
    ? await context.env.ASTROW.fetch(context.request)
    : await context.next()

  const headers = new Headers(upstream.headers)
  headers.set('Content-Type', 'text/plain; charset=utf-8')
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('X-Content-Type-Options', 'nosniff')
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
}
