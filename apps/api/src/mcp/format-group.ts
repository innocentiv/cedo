import { type GroupMembership, sayGroup } from '@cedo/contract'
import * as GroupService from '../modules/group/service.ts'
import type { Caller } from '../plugins/auth.ts'

/** A group as every MCP line names it: `mine`, `library`, or its name (#47). */
const said = (group: GroupMembership): string =>
  sayGroup(group, { personal: 'mine', library: 'library' })

/** One of the caller's groups, with their role and the id the tools that take one want (#52). */
export const groupLine = (group: GroupMembership): string =>
  `${said(group)} | ${group.role} | ${group.id}`

/** The owning group of an exercise or a workout, as a line names it (#47). */
export type GroupNameOf = (groupId: string) => string

/**
 * The groups the caller belongs to, named as every MCP line names an owning group: `mine`,
 * `library`, or the group's name. Whatever a caller can see is owned by one of their groups, so
 * nothing needs a join of its own, and nothing is named that they may not read.
 */
export async function groupNamesOf(caller: Caller): Promise<GroupNameOf> {
  const named = new Map((await GroupService.list(caller)).map((group) => [group.id, said(group)]))
  // Only between a membership lost and the read that still showed its exercise.
  return (groupId) => named.get(groupId) ?? 'another group'
}

/**
 * `[mine]`, `[library, read-only]`: who owns it, and — when the caller cannot change it — that
 * they cannot. A workout's flags whole; an exercise's lead with it.
 */
export const ownership = (
  ownable: { readonly ownerGroupId: string; readonly canEdit: boolean },
  groupNameOf: GroupNameOf,
): string[] => [groupNameOf(ownable.ownerGroupId), ...(ownable.canEdit ? [] : ['read-only'])]
