import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  Id,
  PersonalAccessToken,
  PersonalAccessTokenCreate,
  PersonalAccessTokenCreated,
} from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import * as TokenService from './service.ts'

/** Credentials for MCP clients, so an AI acts as a real user. See docs/07-mcp.md. */
export const tokenRoutes = new Elysia({ prefix: '/tokens', tags: ['tokens'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get('/', ({ caller }) => TokenService.list(caller), {
    response: z.array(PersonalAccessToken),
    detail: { summary: 'Personal access tokens, never including the secret' },
  })
  .post('/', ({ caller, body }) => TokenService.create(caller, body), {
    body: PersonalAccessTokenCreate,
    response: PersonalAccessTokenCreated,
    detail: { summary: 'Create a token. The secret is shown once and cannot be recovered.' },
  })
  .delete(
    '/:id',
    async ({ caller, params }) => {
      await TokenService.revoke(caller, params.id)
      return { ok: true }
    },
    { params: z.object({ id: Id }) },
  )
