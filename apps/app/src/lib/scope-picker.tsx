import { type GroupMembership, isLibrary } from '@cedo/contract'
import { FilterSheet, OptionRow, OptionSection, Stack } from '../ui/index.ts'
import { useGroups } from '../api/queries.ts'

/** Which slice of the visible ownables a list shows — the contract's scope, with its group. */
export type ScopeChoice =
  | { readonly scope: 'all' | 'mine' | 'favourites' }
  | { readonly scope: 'group'; readonly groupId: string }

export const ALL: ScopeChoice = { scope: 'all' }

interface ScopeOption {
  /** Its test id's tail. */
  readonly id: string
  readonly label: string
  readonly choice: ScopeChoice
}

/**
 * A list's scope (#52): All Groups, Mine, Library, Pinned — every account has those — then each
 * shared group of yours by name, under Your groups, when you belong to any. One choice at a time,
 * as the contract's scope is one; choosing closes the sheet. The trigger reads the chosen option's
 * label, so the two never name one choice differently.
 */
export function ScopePicker({
  value,
  onChange,
  testID,
}: {
  readonly value: ScopeChoice
  readonly onChange: (choice: ScopeChoice) => void
  readonly testID: string
}): React.JSX.Element {
  const { fixed, yours } = optionsOf(useGroups().data ?? [])
  const chosen = [...fixed, ...yours].find((option) => same(option.choice, value))
  const rows = (options: readonly ScopeOption[], choose: (take: () => void) => void) => (
    <Stack gap="xs">
      {options.map((option) => (
        <OptionRow
          key={option.id}
          label={option.label}
          selected={option === chosen}
          onPress={() => {
            choose(() => {
              onChange(option.choice)
            })
          }}
          testID={`${testID}-${option.id}`}
        />
      ))}
    </Stack>
  )
  return (
    <FilterSheet
      icon="group"
      label="Show"
      // Not among them only while your groups load, or after you leave the one chosen.
      value={chosen?.label ?? 'A group'}
      active={value.scope !== 'all'}
      testID={testID}
    >
      {(choose) => (
        <>
          {rows(fixed, choose)}
          {yours.length === 0 ? null : (
            <OptionSection title="Your groups">{rows(yours, choose)}</OptionSection>
          )}
        </>
      )}
    </FilterSheet>
  )
}

/** The fixed options, the library among them; and your shared groups, each by name. */
function optionsOf(groups: readonly GroupMembership[]): {
  readonly fixed: readonly ScopeOption[]
  readonly yours: readonly ScopeOption[]
} {
  const library = groups.find((group) => isLibrary(group))
  return {
    fixed: [
      { id: 'all', label: 'All Groups', choice: ALL },
      { id: 'mine', label: 'Mine', choice: { scope: 'mine' } },
      ...(library === undefined
        ? []
        : [{ id: 'library', label: 'Library', choice: inGroup(library) }]),
      { id: 'favourites', label: 'Pinned', choice: { scope: 'favourites' } },
    ],
    yours: groups
      .filter((group) => group.kind === 'shared' && !isLibrary(group))
      .map((group) => ({ id: `group-${group.id}`, label: group.name, choice: inGroup(group) })),
  }
}

const inGroup = (group: GroupMembership): ScopeChoice => ({ scope: 'group', groupId: group.id })

const same = (a: ScopeChoice, b: ScopeChoice): boolean =>
  a.scope === b.scope && (a.scope !== 'group' || b.scope !== 'group' || a.groupId === b.groupId)
