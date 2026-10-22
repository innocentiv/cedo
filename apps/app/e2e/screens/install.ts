import type { Page } from '../harness.ts'

/**
 * The installed app: what a browser reads to offer "Add to Home Screen" — the manifest the page
 * links, its icons — and the service worker that keeps the shell. Read from the test process, the
 * way the browser's installer fetches them: what the site serves, not what the page renders.
 */

export interface ServedIcon {
  readonly src: string
  readonly status: number
  readonly type: string | null
  /** From the PNG header; null for anything that is not a PNG. */
  readonly size: { readonly width: number; readonly height: number } | null
}

/** A PNG's width and height sit at bytes 16–23 of its IHDR chunk, after the 8-byte signature. */
function pngSize(bytes: Uint8Array): ServedIcon['size'] {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

export const install = (page: Page) => ({
  /** The manifest the page links, as served, and every icon it names, fetched. */
  manifest: async (): Promise<{ readonly manifest: unknown; readonly icons: ServedIcon[] }> => {
    await page.goto('/')
    const href = await page.evaluate(
      `document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? null`,
    )
    if (typeof href !== 'string') throw new Error('The page links no manifest')
    const manifest: unknown = await (await fetch(new URL(href, page.origin))).json()
    const named =
      typeof manifest === 'object' && manifest !== null && 'icons' in manifest ? manifest.icons : []
    const srcs = Array.isArray(named)
      ? named.flatMap((icon: unknown) =>
          typeof icon === 'object' && icon !== null && 'src' in icon && typeof icon.src === 'string'
            ? [icon.src]
            : [],
        )
      : []
    const icons = await Promise.all(
      srcs.map(async (src): Promise<ServedIcon> => {
        const response = await fetch(new URL(src, page.origin))
        return {
          src,
          status: response.status,
          type: response.headers.get('content-type'),
          size: pngSize(new Uint8Array(await response.arrayBuffer())),
        }
      }),
    )
    return { manifest, icons }
  },
  /** Opens the app, waits until a service worker controls it, and says the worker's scope. */
  workerScope: async (): Promise<string> => {
    await page.goto('/')
    await page.until(
      async () => await page.evaluate('navigator.serviceWorker?.controller != null'),
      (controlled) => controlled === true,
    )
    const scope = await page.evaluate(
      `navigator.serviceWorker.getRegistration().then((r) => r?.scope ?? null)`,
    )
    if (typeof scope !== 'string') throw new Error('No service worker is registered')
    return scope
  },
})
