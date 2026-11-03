import { useState } from 'react'
import { type GroupMembership, sayGroup } from '@cedo/contract'
import {
  Button,
  ConfirmButton,
  FormError,
  IconButton,
  Loaded,
  PinButton,
  Stack,
  Text,
} from '../ui/index.ts'
import { useGroups } from '../api/queries.ts'
import { useSubmit } from './use-submit.ts'

const nameOf = (group: GroupMembership): string =>
  sayGroup(group, { personal: 'your personal group', library: 'the starter library' })

/** Pinning it, as the line under its name offers it: whether it is, and a tap to change that. */
export interface Pinning {
  readonly pinned: boolean
  readonly onToggle: () => void
  readonly busy: boolean
  /** Why the last tap was refused. */
  readonly error: string | null
  readonly testID: string
}

/**
 * One line under an exercise's or a plan's name: which group it is in, then — small, as glyphs, being
 * rarely used — a star pinning it, and a transfer to another group the server says you may transfer
 * into (`canTransferInto`), when you edit it. The transfer opens its choice under the line, asked
 * twice: it can be transferred back, but every transfer has a shared group on one side — your
 * personal group is your only one — and others feel it at once. Out of the starter library it leaves
 * every account; out of a group, the members' plans lose it; into one, everyone in it sees it. A
 * refusal is the server's, shown as it is: a plan goes only where every exercise it uses can be read,
 * and says which cannot.
 */
export function GroupPlacement({
  ownerGroupId,
  canEdit,
  transfer,
  pin,
  testID,
}: {
  readonly ownerGroupId: string
  readonly canEdit: boolean
  readonly transfer: (toGroupId: string) => Promise<unknown>
  readonly pin: Pinning
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
          pin={pin}
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
  pin,
  testID,
}: {
  readonly owner: GroupMembership | undefined
  readonly targets: readonly GroupMembership[]
  readonly transfer: (toGroupId: string) => Promise<unknown>
  readonly pin: Pinning
  readonly testID: string
}): React.JSX.Element {
  const { submit, busy, error } = useSubmit()
  const [choosing, setChoosing] = useState(false)
  const movable = targets.length > 0
  return (
    <Stack gap="xs">
      <Stack direction="row" align="center">
        <Stack grow>
          {owner === undefined ? null : (
            <Text variant="caption" tone="muted" numberOfLines={1} testID={`${testID}-owner`}>
              {`In ${nameOf(owner)}`}
            </Text>
          )}
        </Stack>
        <PinButton
          pinned={pin.pinned}
          busy={pin.busy}
          onToggle={pin.onToggle}
          // The last glyph lines up with the content's edge.
          edge={movable ? undefined : 'end'}
          testID={pin.testID}
        />
        {movable ? (
          <IconButton
            name="transfer"
            label="Transfer to group"
            tone={choosing ? 'default' : 'muted'}
            edge="end"
            onPress={() => {
              setChoosing(!choosing)
            }}
            testID={testID}
          />
        ) : null}
      </Stack>
      <FormError message={pin.error} testID={`${pin.testID}-error`} />
      {movable && choosing ? (
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
      ) : null}
      <FormError message={error} testID={`${testID}-error`} />
    </Stack>
  )
}
