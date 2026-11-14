import { type GroupMembership, sayGroup } from '@cedo/contract'

/**
 * A group as the MCP lines name it. Like every `format*.ts` here, it reads nothing: a contract
 * value in, text out — so each is tested by a call (docs/07-mcp.md, "Adding a tool"). What a line
 * needs read for it is read by the tool (`tools/group-names.ts`).
 */

/** A group as every MCP line names it: `mine`, `library`, or its name (#47). */
const said = (group: GroupMembership): string =>
  sayGroup(group, { personal: 'mine', library: 'library' })

/** One of the caller's groups, with their role and the id the tools that take one want (#52). */
export const groupLine = (group: GroupMembership): string =>
  `${said(group)} | ${group.role} | ${group.id}`

/** The caller's groups, a line each. */
export const groupLines = (groups: readonly GroupMembership[]): string =>
  groups.map((group) => groupLine(group)).join('\n')

/** The owning group of an exercise or a workout, as a line names it (#47). */
export type GroupNameOf = (groupId: string) => string

/**
 * The caller's groups, named as every MCP line names an owning group: `mine`, `library`, or the
 * group's name. Whatever a caller can see is owned by one of their groups, so nothing needs a join
 * of its own, and nothing is named that they may not read.
 */
export function groupNames(groups: readonly GroupMembership[]): GroupNameOf {
  const named = new Map(groups.map((group) => [group.id, said(group)]))
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
