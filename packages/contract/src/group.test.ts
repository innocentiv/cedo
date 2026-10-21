import { describe, expect, test } from 'bun:test'
import { type GroupMembership, groupsToMoveInto } from './group.ts'

const membership = (name: string, role: 'editor' | 'reader'): GroupMembership => ({
  id: crypto.randomUUID(),
  slug: name.toLowerCase(),
  name,
  kind: 'shared',
  createdAt: new Date().toISOString(),
  role,
  memberCount: 1,
  canManage: role === 'editor',
  canLeave: true,
})

describe('the groups something can be moved into', () => {
  const mine = membership('Mine', 'editor')
  const squad = membership('Squad', 'editor')
  const coached = membership('Coached', 'reader')

  /** The server moves nothing into a group you cannot edit, nor out of one. */
  test('every group you edit — never one you only read', () => {
    expect(groupsToMoveInto([mine, squad, coached], 'elsewhere')).toEqual([mine, squad])
  })

  test('never the group it is already in', () => {
    expect(groupsToMoveInto([mine, squad, coached], squad.id)).toEqual([mine])
  })
})
