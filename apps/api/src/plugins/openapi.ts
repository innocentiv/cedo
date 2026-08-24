import { openapi } from '@elysiajs/openapi'
import { z } from 'zod'

/**
 * Serves the spec at /openapi (Scalar UI) and /openapi/json.
 *
 * `mapJsonSchema` is required because Elysia's native validator is TypeBox; Zod has its own JSON
 * Schema output and the plugin has to be told how to reach it. Without this, every route
 * documents as an empty object. See docs/04-contract.md.
 *
 * A FACTORY, not a shared constant. The plugin registers the Scalar UI as a static `Response`, and
 * a Response body can only be read once — so a module-level singleton works until something
 * requests /openapi, after which every later `createApp()` throws ERR_BODY_ALREADY_USED. Since the
 * test harness builds an app per test, that made `createApp()` silently non-reusable.
 */
export const createOpenapiPlugin = () =>
  openapi({
    mapJsonSchema: {
      zod: (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'input' }),
    },
    documentation: {
      info: {
        title: 'cedo API',
        version: '0.0.0',
        description:
          'Self-hosted workout tracker. The same schemas back these routes, the MCP tools at ' +
          '/mcp, and the client — see docs/04-contract.md.',
      },
    },
  })
