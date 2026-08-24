// @ts-check
const { getDefaultConfig } = require('expo/metro-config')

/**
 * The development counterpart of the Caddyfile.
 *
 * In production Caddy serves the app and proxies `/api` to the API container, so the browser sees
 * ONE origin and the app calls the relative path `/api`. The Metro dev server has no such proxy, so
 * without this every request from `bun run dev` hit Metro instead and came back 404 — the app came
 * up, looked fine, and could not sign anyone in.
 *
 * Proxying here rather than pointing the app at `http://localhost:3000` keeps development the same
 * shape as production: same relative path, same single origin, and no CORS anywhere in the project.
 * See docs/09-deployment.md and docs/adr/0005 (three containers, one published port).
 */
const API_ORIGIN = process.env.CEDO_DEV_API_ORIGIN ?? 'http://127.0.0.1:3000'

/** Replays one request against the API and copies the answer back. */
async function forward(target, req, res, body) {
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && body.length > 0
  try {
    const upstream = await fetch(target, {
      method: req.method,
      // `host` would name the dev server, and a hop-by-hop header confuses fetch.
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(([name]) => name !== 'host' && name !== 'connection'),
      ),
      ...(hasBody ? { body } : {}),
    })
    res.statusCode = upstream.status
    upstream.headers.forEach((value, name) => {
      // Both describe the body BEFORE it was decoded; re-sending them corrupts the response.
      if (name !== 'content-encoding' && name !== 'content-length') res.setHeader(name, value)
    })
    res.end(Buffer.from(await upstream.arrayBuffer()))
  } catch {
    // The API is not running. Say so in the RESPONSE — the browser shows only a failed fetch, and
    // the developer goes looking in the frontend.
    res.statusCode = 502
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        error: {
          code: 'internal',
          message: `No API at ${API_ORIGIN}. Start it with \`bun run dev\`.`,
          details: null,
        },
      }),
    )
  }
}

const config = getDefaultConfig(__dirname)

const base = config.server?.enhanceMiddleware

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware, server) => {
    const next = base ? base(middleware, server) : middleware

    return (req, res, nextHandler) => {
      const url = req.url ?? ''
      if (url !== '/api' && !url.startsWith('/api/')) return next(req, res, nextHandler)

      const target = `${API_ORIGIN}${url.replace(/^\/api/u, '') || '/'}`
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        void forward(target, req, res, Buffer.concat(chunks))
      })
    }
  },
}

module.exports = config
