import { describe, expect, test } from 'bun:test'
import { DEFAULT_GROUP_SLUG, GroupMembership } from '@cedo/contract'
import { groupLine, groupLines, groupNames, ownership } from './format-group.ts'

/**
 * How the MCP lines name a group, as the model reads it: a contract value in, text out, with no
 * wire and no database (docs/07-mcp.md, "Adding a tool"). That `group_list` and every line of an
 * exercise or a workout reach these is `mcp.test.ts`'s, through the wire.
 */

const PERSONAL = '00000000-0000-4000-8000-000000000001'
const LIBRARY = '00000000-0000-4000-8000-000000000002'
const SQUAD = '00000000-0000-4000-8000-000000000003'
const LEFT = '00000000-0000-4000-8000-000000000004'

/** A shared group called Squad, as one of its editors sees it. */
const membership = (fields: Partial<GroupMembership> = {}): GroupMembership =>
  GroupMembership.parse({
    id: SQUAD,
    slug: 'squad',
    name: 'Squad',
    kind: 'shared',
    createdAt: '2026-09-01T08:00:00.000Z',
    role: 'editor',
    memberCount: 3,
    canManage: true,
    canLeave: true,
    canTransferInto: true,
    sharesTraining: false,
    canShareTraining: true,
    ...fields,
  })

/** Sam's own group: named after them, and never said by that name. */
const personal = membership({
  id: PERSONAL,
  slug: 'sam',
  name: 'sam',
  kind: 'personal',
  memberCount: 1,
  canManage: false,
  canLeave: false,
  canShareTraining: false,
})

/** The starter library, as every account but a curator belongs to it: a reader. */
const library = membership({
  id: LIBRARY,
  slug: DEFAULT_GROUP_SLUG,
  name: 'cedo',
  role: 'reader',
  canManage: false,
  canLeave: false,
  canTransferInto: false,
  canShareTraining: false,
})

/** #52: the ids the tools that take a group want, each beside what the group is called. */
describe('one of the caller’s groups', () => {
  test('their personal group is mine, with their role and its id', () => {
    expect(groupLine(personal)).toBe(`mine | editor | ${PERSONAL}`)
  })

  test('the library is the library, to a reader of it', () => {
    expect(groupLine(library)).toBe(`library | reader | ${LIBRARY}`)
  })

  test('and to a curator, its editor', () => {
    expect(groupLine({ ...library, role: 'editor' })).toBe(`library | editor | ${LIBRARY}`)
  })

  test('any other group goes by its name, to an editor', () => {
    expect(groupLine(membership())).toBe(`Squad | editor | ${SQUAD}`)
  })

  test('and to a reader', () => {
    expect(groupLine(membership({ role: 'reader' }))).toBe(`Squad | reader | ${SQUAD}`)
  })
})

/** #47: an owning group is named as `group_list` names it, so a line and the list agree. */
describe('the owning group of a line', () => {
  const nameOf = groupNames([personal, library, membership()])

  test('is named as the caller’s groups are: mine, library, or its name', () => {
    expect([nameOf(PERSONAL), nameOf(LIBRARY), nameOf(SQUAD)]).toEqual(['mine', 'library', 'Squad'])
  })

  /** Only between a membership lost and the read that still showed what the group owns. */
  test('a group the caller does not belong to is another group, never named', () => {
    expect(nameOf(LEFT)).toBe('another group')
  })
})

describe('who owns it, and whether the caller can change it', () => {
  const nameOf = groupNames([personal, library, membership()])

  test('editable, it is its owning group alone', () => {
    expect(ownership({ ownerGroupId: PERSONAL, canEdit: true }, nameOf)).toEqual(['mine'])
  })

  test('not editable, it is read-only after its owning group', () => {
    expect(ownership({ ownerGroupId: LIBRARY, canEdit: false }, nameOf)).toEqual([
      'library',
      'read-only',
    ])
  })

  test('a named group’s, read by a reader of it', () => {
    expect(ownership({ ownerGroupId: SQUAD, canEdit: false }, nameOf)).toEqual([
      'Squad',
      'read-only',
    ])
  })
})

describe('the caller’s groups, listed', () => {
  test('a line each, in the order given', () => {
    expect(groupLines([personal, library, membership({ role: 'reader' })])).toBe(
      [
        `mine | editor | ${PERSONAL}`,
        `library | reader | ${LIBRARY}`,
        `Squad | reader | ${SQUAD}`,
      ].join('\n'),
    )
  })
})
