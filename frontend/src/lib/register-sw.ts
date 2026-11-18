import { toast } from './toast'

/**
 * Registers the service worker in production only. In dev, HMR and Vite
 * require an unintercepted network and caching assets would add noise.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener(
    'load',
    () => {
      void navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          registration.addEventListener('updatefound', () => {
            const installing = registration.installing
            if (!installing) return
            installing.addEventListener('statechange', () => {
              if (
                installing.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                installing.postMessage({ type: 'SKIP_WAITING' })
                toast.info('App update ready', {
                  message: 'Refresh to load the latest AstroGate release.',
                })
              }
            })
          })
        })
        .catch((error) => {
          console.warn('Failed to register service worker:', error)
        })
    },
    { once: true },
  )
}
