import { useState } from 'react'
import { type GroupMembership, isLibrary } from '@cedo/contract'
import { FilterTrigger, OptionRow, OptionSection, Sheet, Stack } from '../ui/index.ts'
import { useGroups } from '../api/queries.ts'

/** Which slice of the visible ownables a list shows — the contract's scope, with its group. */
export type ScopeChoice =
  | { readonly scope: 'all' | 'mine' | 'favourites' }
  | { readonly scope: 'group'; readonly groupId: string }

export const ALL: ScopeChoice = { scope: 'all' }

/**
 * A list's scope (#52): All Groups, Mine, Library, Pinned — every account has those — then each
 * shared group of yours by name, under Your groups, when you belong to any. One choice at a time,
 * as the contract's scope is one; choosing closes the sheet.
 */
export function ScopeFilter({
  value,
  onChange,
  testID,
}: {
  readonly value: ScopeChoice
  readonly onChange: (choice: ScopeChoice) => void
  readonly testID: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const groups = useGroups().data ?? []
  const library = groups.find((group) => isLibrary(group))
  const shared = groups.filter((group) => group.kind === 'shared' && !isLibrary(group))
  const choose = (choice: ScopeChoice) => {
    onChange(choice)
    setOpen(false)
  }
  const fixed: readonly { id: string; label: string; choice: ScopeChoice }[] = [
    { id: 'all', label: 'All Groups', choice: ALL },
    { id: 'mine', label: 'Mine', choice: { scope: 'mine' } },
    ...(library === undefined
      ? []
      : [{ id: 'library', label: 'Library', choice: inGroup(library) }]),
    { id: 'favourites', label: 'Pinned', choice: { scope: 'favourites' } },
  ]
  return (
    <>
      <FilterTrigger
        icon="group"
        label="Show"
        value={labelOf(value, groups)}
        active={value.scope !== 'all'}
        onPress={() => {
          setOpen(true)
        }}
        testID={testID}
      />
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false)
        }}
        title="Show"
        testID={`${testID}-sheet`}
      >
        <Stack gap="xs">
          {fixed.map((option) => (
            <OptionRow
              key={option.id}
              label={option.label}
              selected={same(option.choice, value)}
              onPress={() => {
                choose(option.choice)
              }}
              testID={`${testID}-${option.id}`}
            />
          ))}
        </Stack>
        {shared.length === 0 ? null : (
          <OptionSection title="Your groups">
            <Stack gap="xs">
              {shared.map((group) => (
                <OptionRow
                  key={group.id}
                  label={group.name}
                  selected={same(inGroup(group), value)}
                  onPress={() => {
                    choose(inGroup(group))
                  }}
                  testID={`${testID}-group-${group.id}`}
                />
              ))}
            </Stack>
          </OptionSection>
        )}
      </Sheet>
    </>
  )
}

const inGroup = (group: GroupMembership): ScopeChoice => ({ scope: 'group', groupId: group.id })

const same = (a: ScopeChoice, b: ScopeChoice): boolean =>
  a.scope === b.scope && (a.scope !== 'group' || b.scope !== 'group' || a.groupId === b.groupId)

/** What the trigger says: the choice as its sheet names it. */
function labelOf(choice: ScopeChoice, groups: readonly GroupMembership[]): string {
  switch (choice.scope) {
    case 'all':
      return 'All Groups'
    case 'mine':
      return 'Mine'
    case 'favourites':
      return 'Pinned'
    case 'group': {
      const group = groups.find((g) => g.id === choice.groupId)
      if (group === undefined) return 'A group'
      return isLibrary(group) ? 'Library' : group.name
    }
  }
}
