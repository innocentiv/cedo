import { openapi } from '@elysia/openapi'
import { VERSION } from '@cedo/contract'
import { z } from 'zod'

/**
 * Serves the spec at /openapi (Scalar UI) and /openapi/json.
 *
 * `mapJsonSchema` says how a Zod schema becomes JSON Schema: its INPUT side, which is what a
 * caller may send. Under Elysia 1.x it was required, or every route documented as an empty
 * object. Elysia 2 reads a Zod schema without it, but as its output side, which changes about
 * four hundred `required` and `additionalProperties` entries of the document; so it stays.
 * See docs/04-contract.md.
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
        version: VERSION,
        description:
          'Self-hosted workout tracker. The same schemas back these routes, the MCP tools at ' +
          '/mcp, and the client — see docs/04-contract.md.',
      },
    },
  })
