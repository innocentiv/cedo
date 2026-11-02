import { sayGroup } from '@cedo/contract'
import { useGroups } from '../api/queries.ts'

/**
 * The group that owns a listed exercise or workout, as a row says it (#47): `Mine`, `Library`, or
 * the group's name — so a copy never reads like what it was copied from. Named from the groups the
 * reader belongs to, which own everything they can see; nothing while those are loading.
 */
export function useOwnerName(): (ownerGroupId: string) => string | undefined {
  const groups = useGroups().data ?? []
  return (ownerGroupId) => {
    const owner = groups.find((group) => group.id === ownerGroupId)
    return owner === undefined
      ? undefined
      : sayGroup(owner, { personal: 'Mine', library: 'Library' })
  }
}
