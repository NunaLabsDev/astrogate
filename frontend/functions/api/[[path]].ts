import { forwardToWorker, type PagesProxyContext } from '../_proxy'

export function onRequest(context: PagesProxyContext): Promise<Response> {
  return forwardToWorker(context)
}
