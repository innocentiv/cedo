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
  .get(
    '/',
    {
      response: z.array(GroupMembership),
      detail: { summary: 'Groups the caller belongs to' },
    },
    ({ caller }) => GroupService.list(caller),
  )
  .post(
    '/',
    {
      body: GroupCreate,
      response: GroupMembership,
      detail: { summary: 'Create a shared group with the caller as its editor' },
    },
    ({ caller, body }) => GroupService.create(caller, body),
  )
  .patch(
    '/:id/membership',
    {
      params: z.object({ id: Id }),
      body: GroupMembershipPatch,
      response: GroupMembership,
      detail: { summary: "The caller's own membership: whether its editors read their training" },
    },
    ({ caller, params, body }) => GroupSharing.setSharing(caller, params.id, body),
  )
  .get(
    '/:id/members',
    {
      params: z.object({ id: Id }),
      response: z.array(GroupMember),
    },
    ({ caller, params }) => GroupService.members(caller, params.id),
  )
  .post(
    '/:id/members',
    {
      params: z.object({ id: Id }),
      body: GroupAddMember,
      response: GroupMember,
    },
    ({ caller, params, body }) => GroupService.addMember(caller, params.id, body),
  )
  .delete(
    '/:id/members/:userId',
    {
      params: z.object({ id: Id, userId: Id }),
    },
    async ({ caller, params }) => {
      await GroupService.removeMember(caller, params.id, params.userId)
      return { ok: true }
    },
  )
