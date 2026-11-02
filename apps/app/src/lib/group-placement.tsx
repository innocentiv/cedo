import { useState } from 'react'
import { type GroupMembership, sayGroup } from '@cedo/contract'
import { Button, ConfirmButton, FormError, Loaded, Stack, Text } from '../ui/index.ts'
import { useGroups } from '../api/queries.ts'
import { useSubmit } from './use-submit.ts'

const nameOf = (group: GroupMembership): string =>
  sayGroup(group, { personal: 'your personal group', library: 'the starter library' })

/**
 * Which group something is in, and — when you edit it — a transfer to another the server says you
 * may transfer into (`canTransferInto`). Asked twice: it can be transferred back, but every transfer
 * has a shared group on one side — your personal group is your only one — and others feel it at
 * once. Out of the starter library it leaves every account; out of a group, the members' plans lose
 * it; into one, everyone in it sees it. A refusal is the server's, shown as it is: a plan goes only
 * where every exercise it uses can be read, and says which cannot.
 */
export function GroupPlacement({
  ownerGroupId,
  canEdit,
  transfer,
  testID,
}: {
  readonly ownerGroupId: string
  readonly canEdit: boolean
  readonly transfer: (toGroupId: string) => Promise<unknown>
  readonly testID: string
}): React.JSX.Element {
  const groups = useGroups()
  return (
    <Loaded query={groups} testID={`${testID}-groups`}>
      {(mine) => (
        <Placement
          owner={mine.find((g) => g.id === ownerGroupId)}
          targets={canEdit ? mine.filter((g) => g.canTransferInto && g.id !== ownerGroupId) : []}
          transfer={transfer}
          testID={testID}
        />
      )}
    </Loaded>
  )
}

function Placement({
  owner,
  targets,
  transfer,
  testID,
}: {
  readonly owner: GroupMembership | undefined
  readonly targets: readonly GroupMembership[]
  readonly transfer: (toGroupId: string) => Promise<unknown>
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
            <ConfirmButton
              key={group.id}
              title={`Transfer to ${nameOf(group)}`}
              busy={busy}
              onConfirm={async () => {
                await submit(async () => {
                  await transfer(group.id)
                })
                setChoosing(false)
              }}
              testID={`${testID}-to-${group.id}`}
            />
          ))}
          <Button
            // Not "Cancel": an armed transfer beside it has its own.
            title="Keep it where it is"
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
          title="Transfer to group"
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
