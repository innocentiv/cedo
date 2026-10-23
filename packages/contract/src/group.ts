import { z } from 'zod'
import { Id, NonEmptyString, Slug, Timestamp } from './primitives.ts'
import { Account, User, Username } from './user.ts'

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

/**
 * A group as seen by the current user, carrying their own role in it, and what they may do with it
 * — said by the server, as `canEdit` is for what they own, so a client offers only what will be
 * accepted and holds none of the rules.
 */
export const GroupMembership = Group.extend({
  role: GroupRole,
  memberCount: z.int().nonnegative(),
  /** Add members and remove them: an editor of a shared group other than the starter library. */
  canManage: z.boolean(),
  /**
   * Remove themselves: any member of a shared group other than the starter library, unless they
   * are its last editor.
   */
  canLeave: z.boolean(),
  /** Transfer what they edit into it: any group they edit — the starter library, for a curator. */
  canTransferInto: z.boolean(),
  /** They let this group's editors read their training (#11). See GLOSSARY.md, "Share training". */
  sharesTraining: z.boolean(),
  /**
   * Switch `sharesTraining`: any member of a shared group other than the starter library — never
   * a personal group, nor the library every account belongs to.
   */
  canShareTraining: z.boolean(),
})
export type GroupMembership = z.output<typeof GroupMembership>

export const GroupMember = z.object({
  user: User,
  role: GroupRole,
  joinedAt: Timestamp,
  /** This member reads the caller's training through this group: an editor, and not the caller. */
  readsYourTraining: z.boolean(),
})
export type GroupMember = z.output<typeof GroupMember>

/** `PATCH /groups/:id/membership` — the caller's own membership. */
export const GroupMembershipPatch = z.strictObject({
  sharesTraining: z.boolean(),
})
export type GroupMembershipPatch = z.output<typeof GroupMembershipPatch>

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
  user: Account,
  groups: z.array(GroupMembership),
})
export type Me = z.output<typeof Me>
