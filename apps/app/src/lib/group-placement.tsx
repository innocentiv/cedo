import { useState } from 'react'
import { DEFAULT_GROUP_SLUG, type GroupMembership } from '@cedo/contract'
import { Button, FormError, Loaded, Stack, Text } from '../ui/index.ts'
import { useGroups } from '../api/queries.ts'
import { useSubmit } from './use-submit.ts'

const nameOf = (group: GroupMembership): string => {
  if (group.kind === 'personal') return 'your personal group'
  return group.slug === DEFAULT_GROUP_SLUG ? 'the starter library' : group.name
}

/**
 * Which group something is in, and — when you edit it — Move to another the server says you may
 * move into (`canMoveInto`). Not asked twice: you edit both groups, so it can always be moved back.
 * A refusal is the server's, shown as it is: a plan goes only where every exercise it uses can be
 * read, and says which cannot.
 */
export function GroupPlacement({
  ownerGroupId,
  canEdit,
  move,
  testID,
}: {
  readonly ownerGroupId: string
  readonly canEdit: boolean
  readonly move: (toGroupId: string) => Promise<unknown>
  readonly testID: string
}): React.JSX.Element {
  const groups = useGroups()
  return (
    <Loaded query={groups} testID={`${testID}-groups`}>
      {(mine) => (
        <Placement
          owner={mine.find((g) => g.id === ownerGroupId)}
          targets={canEdit ? mine.filter((g) => g.canMoveInto && g.id !== ownerGroupId) : []}
          move={move}
          testID={testID}
        />
      )}
    </Loaded>
  )
}

function Placement({
  owner,
  targets,
  move,
  testID,
}: {
  readonly owner: GroupMembership | undefined
  readonly targets: readonly GroupMembership[]
  readonly move: (toGroupId: string) => Promise<unknown>
  readonly testID: string
}): React.JSX.Element {
  const { submit, busy, error } = useSubmit()
  const [choosing, setChoosing] = useState(false)
  return (
    <Stack gap="sm">
      {owner === undefined ? null : (
        <Text variant="caption" tone="muted" testID={`${testID}-owner`}>
          {`In ${nameOf(owner)}`}
        </Text>
      )}
      {targets.length === 0 ? null : choosing ? (
        <Stack gap="xs" testID={`${testID}-targets`}>
          {targets.map((group) => (
            <Button
              key={group.id}
              title={`Move to ${nameOf(group)}`}
              variant="secondary"
              busy={busy}
              onPress={() => {
                void submit(async () => {
                  await move(group.id)
                }).finally(() => {
                  setChoosing(false)
                })
              }}
              testID={`${testID}-to-${group.id}`}
            />
          ))}
          <Button
            title="Cancel"
            variant="ghost"
            disabled={busy}
            onPress={() => {
              setChoosing(false)
            }}
            testID={`${testID}-cancel`}
          />
        </Stack>
      ) : (
        <Button
          title="Move to group"
          variant="secondary"
          onPress={() => {
            setChoosing(true)
          }}
          testID={testID}
        />
      )}
      <FormError message={error} testID={`${testID}-error`} />
    </Stack>
  )
}
