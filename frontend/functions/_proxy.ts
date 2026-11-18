export interface PagesProxyEnv {
  ASTROW?: {
    fetch: (request: Request | string, init?: RequestInit) => Promise<Response>
  }
}

export interface PagesProxyContext {
  request: Request
  env: PagesProxyEnv
}

/**
 * Forwards dynamic API, MCP, and Telegram webhook routes from Cloudflare Pages
 * (`astrogate.pages.dev`) to the `astrogate-stellar` Worker via Service Binding.
 */
export async function forwardToWorker(
  context: PagesProxyContext,
): Promise<Response> {
  if (!context.env.ASTROW) {
    return Response.json(
      { ok: false, error: 'ASTROW worker service binding is not configured.' },
      { status: 503 },
    )
  }
  return context.env.ASTROW.fetch(context.request)
}
