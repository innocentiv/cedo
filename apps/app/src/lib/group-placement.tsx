import { useState } from 'react'
import { type GroupMembership, groupsToMoveInto } from '@cedo/contract'
import { Button, FormError, Stack, Text } from '../ui/index.ts'
import { useGroups } from '../api/queries.ts'
import { useSubmit } from './use-submit.ts'

const nameOf = (group: GroupMembership): string =>
  group.kind === 'personal' ? 'your personal group' : group.name

/**
 * Which group something is in, and — when you edit it — Move to another you edit. Not asked twice:
 * you edit both groups, so it can always be moved back. A refusal is the server's, shown as it is:
 * a plan goes only where every exercise it uses can be read, and says which cannot.
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
}): React.JSX.Element | null {
  const groups = useGroups()
  const { submit, busy, error } = useSubmit()
  const [choosing, setChoosing] = useState(false)
  if (groups.data === undefined) return null

  const owner = groups.data.find((g) => g.id === ownerGroupId)
  const targets = canEdit ? groupsToMoveInto(groups.data, ownerGroupId) : []
  return (
    <Stack gap="sm">
      {owner === undefined ? null : (
        <Text variant="caption" tone="muted" testID={`${testID}-owner`}>
          {`In ${nameOf(owner)}`}
        </Text>
      )}
      {targets.length === 0 ? null : choosing ? (
        <Stack gap="xs">
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
