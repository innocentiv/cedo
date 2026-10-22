/**
 * Registers the service worker that keeps the app shell (`service-worker.ts`). Web only, and only
 * in a build: a worker over the dev server would answer with yesterday's unhashed bundle. A refusal
 * is said in the console — where the e2e run fails on it — not swallowed: an app that silently never
 * installs looks fine until the first time there is no signal.
 */
export function registerShell(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
    console.error('The app shell could not be kept for offline use:', error)
  })
}
