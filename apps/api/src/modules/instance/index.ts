import { Elysia } from 'elysia'
import { Instance, InstancePatch } from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import * as InstanceService from './service.ts'

/**
 * The instance itself (#71). `GET` is public: a client asks it before anyone signs in, to know the
 * server is cedo and whether to offer sign-up. `PATCH` is the curator's, and the same function the
 * `instance_sign_up_set` tool calls. See docs/06-api.md.
 */
export const instanceRoutes = new Elysia({ prefix: '/instance', tags: ['instance'] })
  .use(authPlugin)
  .get('', () => InstanceService.describe(), {
    response: Instance,
    detail: { summary: 'What this server is, its version, and whether it takes new accounts' },
  })
  .patch('', ({ caller, body }) => InstanceService.update(caller, body), {
    auth: true,
    body: InstancePatch,
    response: Instance,
    detail: { summary: 'Open or close sign-up. Curator only' },
  })
