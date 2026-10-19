import { Elysia } from 'elysia'
import { AuthResult, LoginInput, Me, MeUpdate, RegisterInput } from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import { bearerToken } from '../../lib/token.ts'
import * as AuthService from './service.ts'

/**
 * Routing and validation only. Every handler delegates to the service, which is the same code the
 * MCP tools call. See docs/02-conventions.md.
 */
export const authRoutes = new Elysia({ prefix: '/auth', tags: ['auth'] })
  .use(authPlugin)
  .post('/register', ({ body }) => AuthService.register(body), {
    body: RegisterInput,
    response: AuthResult,
    detail: { summary: 'Create an account, its personal group, and a session' },
  })
  .post('/login', ({ body }) => AuthService.login(body), {
    body: LoginInput,
    response: AuthResult,
    detail: { summary: 'Exchange credentials for a bearer token' },
  })
  .post(
    '/logout',
    async ({ headers }) => {
      const token = bearerToken(headers['authorization'])
      if (token !== null) await AuthService.logout(token)
      return { ok: true }
    },
    { detail: { summary: 'Revoke the current session' } },
  )
  .get('/me', ({ caller }) => AuthService.me(caller), {
    auth: true,
    response: Me,
    detail: { summary: 'The caller and every group they belong to' },
  })
  .patch('/me', ({ caller, body }) => AuthService.updateMe(caller, body), {
    auth: true,
    body: MeUpdate,
    response: Me,
    detail: { summary: 'Change what a person may change about themselves: their weight unit' },
  })
