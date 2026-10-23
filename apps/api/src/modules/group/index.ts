import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  GroupAddMember,
  GroupCreate,
  GroupMember,
  GroupMembership,
  GroupMembershipPatch,
  Id,
} from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import * as GroupService from './service.ts'
import * as GroupSharing from './sharing.ts'

export const groupRoutes = new Elysia({ prefix: '/groups', tags: ['groups'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get('/', ({ caller }) => GroupService.list(caller), {
    response: z.array(GroupMembership),
    detail: { summary: 'Groups the caller belongs to' },
  })
  .post('/', ({ caller, body }) => GroupService.create(caller, body), {
    body: GroupCreate,
    response: GroupMembership,
    detail: { summary: 'Create a shared group with the caller as its editor' },
  })
  .patch(
    '/:id/membership',
    ({ caller, params, body }) => GroupSharing.setSharing(caller, params.id, body),
    {
      params: z.object({ id: Id }),
      body: GroupMembershipPatch,
      response: GroupMembership,
      detail: { summary: "The caller's own membership: whether its editors read their training" },
    },
  )
  .get('/:id/members', ({ caller, params }) => GroupService.members(caller, params.id), {
    params: z.object({ id: Id }),
    response: z.array(GroupMember),
  })
  .post(
    '/:id/members',
    ({ caller, params, body }) => GroupService.addMember(caller, params.id, body),
    {
      params: z.object({ id: Id }),
      body: GroupAddMember,
      response: GroupMember,
    },
  )
  .delete(
    '/:id/members/:userId',
    async ({ caller, params }) => {
      await GroupService.removeMember(caller, params.id, params.userId)
      return { ok: true }
    },
    {
      params: z.object({ id: Id, userId: Id }),
    },
  )
