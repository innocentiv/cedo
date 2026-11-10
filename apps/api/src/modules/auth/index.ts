import { Elysia } from 'elysia'
import { AuthResult, LoginInput, Me, MeUpdate, RegisterInput } from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import { clientAddress } from '../../lib/client-address.ts'
import { bearerToken } from '../../lib/token.ts'
import * as AuthService from './service.ts'

/**
 * Routing and validation only. Every handler delegates to the service, which is the same code the
 * MCP tools call. See docs/02-conventions.md.
 */
export const authRoutes = new Elysia({ prefix: '/auth', tags: ['auth'] })
  .use(authPlugin)
  .post(
    '/register',
    {
      body: RegisterInput,
      response: AuthResult,
      detail: { summary: 'Create an account, its personal group, and a session' },
    },
    ({ body }) => AuthService.register(body),
  )
  .post(
    '/login',
    {
      body: LoginInput,
      response: AuthResult,
      detail: { summary: 'Exchange credentials for a bearer token' },
    },
    ({ body, headers, request, server }) => {
      const address = clientAddress(headers['x-client-ip'], server?.requestIP(request)?.address)
      return AuthService.login(body, address)
    },
  )
  .post('/logout', { detail: { summary: 'Revoke the current session' } }, async ({ headers }) => {
    const token = bearerToken(headers['authorization'])
    if (token !== null) await AuthService.logout(token)
    return { ok: true }
  })
  .get(
    '/me',
    {
      auth: true,
      response: Me,
      detail: { summary: 'The caller and every group they belong to' },
    },
    ({ caller }) => AuthService.me(caller),
  )
  .patch(
    '/me',
    {
      auth: true,
      body: MeUpdate,
      response: Me,
      detail: { summary: 'Change what a person may change about themselves: their weight unit' },
    },
    ({ caller, body }) => AuthService.updateMe(caller, body),
  )
