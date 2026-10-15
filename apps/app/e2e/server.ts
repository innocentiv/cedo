import { file } from 'bun'
import { join } from 'node:path'

/**
 * Serves the exported web app and proxies `/api` — the same shape as the Caddyfile in production,
 * so a routing mistake shows up here rather than only after a deploy. See docs/09-deployment.md.
 */

/**
 * The capture shim.
 *
 * `Bun.WebView`'s `console:` handler receives `console.*` calls and nothing else — an uncaught
 * exception, a rejected promise or a failed fetch never reach it on their own. Forwarding them is
 * what turns "fail on any console error" into a real guarantee.
 *
 * Injected into the served HTML rather than shipped in the app bundle: there is no
 * `addInitScript` hook, and injecting after navigation with `evaluate` would miss everything thrown
 * during the initial render — the errors most worth catching. See docs/adr/0017.
 */
const CAPTURE_SHIM = `<script>
(function () {
  addEventListener('error', function (e) {
    console.error('[pageerror]', e.message || String(e.error));
  });
  function describe(value) {
    if (value === null || value === undefined) return String(value);
    if (value.message) return value.message;
    // A plain object stringifies to "[object Object]", which names nothing.
    try { return typeof value === 'object' ? JSON.stringify(value) : String(value); }
    catch (_) { return String(value); }
  }
  addEventListener('unhandledrejection', function (e) {
    console.error('[rejection]', describe(e.reason));
  });
  var fetchOriginal = window.fetch;
  window.fetch = function () {
    return fetchOriginal.apply(this, arguments).catch(function (err) {
      console.error('[network]', String(err && err.message ? err.message : err));
      throw err;
    });
  };
})();
</script>`

export interface StaticServer {
  readonly url: string
  stop: () => void
}

/**
 * One `index.html` for every route, mirroring the Caddyfile's `try_files {path} /index.html`. The
 * app is `output: "single"`; see docs/08-frontend.md for why it is not prerendered.
 */
async function resolveHtml(distDir: string, pathname: string): Promise<string | null> {
  const clean = pathname.replace(/\/$/u, '')
  for (const candidate of [clean === '' ? 'index.html' : `${clean.slice(1)}.html`, 'index.html']) {
    const handle = file(join(distDir, candidate))
    if (await handle.exists()) return candidate
  }
  return null
}

export function serveExport(distDir: string, apiUrl: string, port = 0): StaticServer {
  const server = Bun.serve({
    port,
    idleTimeout: 30,
    async fetch(request) {
      const url = new URL(request.url)

      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        const target = new URL(url.pathname.replace(/^\/api/u, '') + url.search, apiUrl)
        return await fetch(target, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          // Streaming a request body to another origin requires this in Bun and Node alike.
          ...(request.body === null ? {} : { duplex: 'half' }),
        })
      }

      const asset = file(join(distDir, url.pathname))
      if (url.pathname !== '/' && (await asset.exists())) return new Response(asset)
      // A missing bundle chunk is a 404, never the app shell — as in the Caddyfile. Answering it
      // with index.html turned a stale chunk into a parse error instead of a visible failure.
      if (url.pathname.startsWith('/_expo/static/')) {
        return new Response('Not found', { status: 404 })
      }

      const html = await resolveHtml(distDir, url.pathname)
      if (html === null) return new Response('Not found', { status: 404 })

      const source = await file(join(distDir, html)).text()
      // Before everything else in <head>, so it is installed before the app bundle evaluates.
      const injected = source.includes('<head>')
        ? source.replace('<head>', `<head>${CAPTURE_SHIM}`)
        : `${CAPTURE_SHIM}${source}`
      return new Response(injected, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    },
  })

  return { url: server.url.href.replace(/\/$/u, ''), stop: () => server.stop(true) }
}
