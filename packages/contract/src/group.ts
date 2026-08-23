import { z } from 'zod'
import { Id, NonEmptyString, Slug, Timestamp } from './primitives.ts'
import { User, Username } from './user.ts'

/**
 * Everything ownable belongs to exactly one group. Every user gets a `personal` group created
 * automatically at registration, so "mine" and "shared with me" are the same mechanism with no
 * special cases — which means one ACL code path instead of two. See docs/03-domain-model.md.
 */

export const GROUP_KINDS = ['personal', 'shared'] as const
export const GroupKind = z.enum(GROUP_KINDS)
export type GroupKind = z.output<typeof GroupKind>

export const GROUP_ROLES = ['editor', 'reader'] as const
export const GroupRole = z.enum(GROUP_ROLES)
export type GroupRole = z.output<typeof GroupRole>

/** The seeded group that carries the starter exercise library. Every user joins it as a reader. */
export const DEFAULT_GROUP_SLUG = 'cedo'

export const Group = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  kind: GroupKind,
  createdAt: Timestamp,
})
export type Group = z.output<typeof Group>

/** A group as seen by the current user, carrying their own role in it. */
export const GroupMembership = Group.extend({
  role: GroupRole,
  memberCount: z.int().nonnegative(),
})
export type GroupMembership = z.output<typeof GroupMembership>

export const GroupMember = z.object({
  user: User,
  role: GroupRole,
  joinedAt: Timestamp,
})
export type GroupMember = z.output<typeof GroupMember>

export const GroupCreate = z.strictObject({
  name: NonEmptyString.max(80),
})
export type GroupCreate = z.output<typeof GroupCreate>

export const GroupAddMember = z.strictObject({
  username: Username,
  role: GroupRole,
})
export type GroupAddMember = z.output<typeof GroupAddMember>

/** `GET /auth/me` — identity plus every group the caller can see, in one round trip. */
export const Me = z.object({
  user: User,
  groups: z.array(GroupMembership),
})
export type Me = z.output<typeof Me>
