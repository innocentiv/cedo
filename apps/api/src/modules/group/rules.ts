import { DEFAULT_GROUP_SLUG, type GroupRole } from '@cedo/contract'
import type { groups } from '../../db/schema.ts'

/**
 * What a member may do with a group, and why not — the rules the group writes enforce and `list`
 * says, in one place. Pure: no query, so each is the one statement of its rule.
 */

export type GroupRow = typeof groups.$inferSelect

/**
 * Why a group's members do not change through the API, or null when they do. A personal group is
 * its owner's alone. The starter library keeps every account: each reads it from registration on,
 * and a shared group's plans may use its exercises for that reason (docs/03-domain-model.md) —
 * someone gone from it would be left with plans they cannot read.
 *
 * The one statement of the rule: `list` says it as `canManage` and `canLeave`, and both member
 * writes refuse with it.
 */
export const keepsItsMembers = (group: GroupRow): string | null => {
  if (group.kind === 'personal')
    return 'A personal group is its owner’s alone: nobody joins or leaves it'
  if (group.slug === DEFAULT_GROUP_SLUG) {
    return 'The starter library keeps every account: nobody joins it, leaves it or is removed from it'
  }
  return null
}

/**
 * Why a member cannot share their training with a group, or null when they can — said by `list` as
 * `canShareTraining`, and the refusal of `setSharing`. A personal group has nobody else in it, and
 * the starter library has every account.
 */
export const sharingRefused = (group: Pick<GroupRow, 'kind' | 'slug'>): string | null => {
  if (group.kind === 'personal')
    return 'Your personal group is yours alone: there is nobody in it to share training with'
  if (group.slug === DEFAULT_GROUP_SLUG)
    return 'The starter library is every account’s: share your training with a group of your own'
  return null
}

/** What a member may do with a group — what the member writes in service.ts and sharing.ts accept. */
export const mayOf = (group: GroupRow, role: GroupRole, editors: number) => {
  const changes = keepsItsMembers(group) === null
  return {
    canManage: changes && role === 'editor',
    // The last editor stays: a group with no editor cannot be administered again.
    canLeave: changes && !(role === 'editor' && editors === 1),
    // What `transferOwnable` asks of the target: the caller edits it.
    canTransferInto: role === 'editor',
    canShareTraining: sharingRefused(group) === null,
  }
}

/**
 * Whether a member reads the caller's training through a group: its editors, once the caller shares
 * — never the caller. The rule `/athletes` asks of a membership too, in SQL (`coaching/athletes.ts`).
 */
export const readsTraining = (member: {
  readonly callerShares: boolean
  readonly role: GroupRole
  readonly isCaller: boolean
}): boolean => member.callerShares && member.role === 'editor' && !member.isCaller
