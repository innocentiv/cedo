import { useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import type { GroupMember, GroupMembership, GroupRole } from '@cedo/contract'
import {
  Button,
  type ChipOption,
  Chips,
  ConfirmButton,
  Empty,
  ErrorNotice,
  Field,
  FormError,
  Input,
  ListRow,
  Loaded,
  Screen,
  Spinner,
  Stack,
  Text,
} from '../../../../../src/ui/index.ts'
import {
  useAddMember,
  useGroupMembers,
  useGroups,
  useLeaveGroup,
  useRemoveMember,
} from '../../../../../src/api/queries.ts'
import { useAuth } from '../../../../../src/auth/auth-provider.tsx'
import { useGoBack } from '../../../../../src/lib/use-go-back.ts'
import { useSubmit } from '../../../../../src/lib/use-submit.ts'

const ROLE_OPTIONS: readonly ChipOption<GroupRole>[] = [
  { value: 'reader', label: 'Reader' },
  { value: 'editor', label: 'Editor' },
]

/**
 * A group: who is in it, and what you may do about that — `canManage` and `canLeave`, as the server
 * says. The group itself comes from the list of yours; there is no read of one group alone.
 */
export default function GroupDetail(): React.JSX.Element {
  const { id = '' } = useLocalSearchParams<{ id: string }>()
  const { data, isPending, error, refetch } = useGroups()

  if (error !== null) {
    return (
      <Screen testID="group-detail-screen">
        <ErrorNotice
          message={error.message}
          onRetry={() => {
            void refetch()
          }}
        />
      </Screen>
    )
  }
  if (isPending) return <Spinner testID="group-loading" />
  const group = data.find((g) => g.id === id)
  if (group === undefined) {
    return (
      <Screen testID="group-detail-screen">
        <Empty title="Not a group of yours" testID="group-gone" />
      </Screen>
    )
  }
  return <Group group={group} />
}

function Group({ group }: { readonly group: GroupMembership }): React.JSX.Element {
  const { me } = useAuth()
  const myId = me?.user.id ?? ''
  const members = useGroupMembers(group.id)
  const leave = useLeaveGroup(myId)
  const goBack = useGoBack('/settings/groups')
  const leaving = useSubmit()

  return (
    <Screen title={group.name} testID="group-detail-screen">
      <Text tone="muted">
        {group.kind === 'personal'
          ? 'Your personal group: private to you.'
          : `Shared · you are ${group.role === 'editor' ? 'an editor' : 'a reader'}`}
      </Text>

      <Loaded query={members} testID="group-members">
        {(list) => (
          <Stack gap="sm" testID="member-list">
            {list.map((member) => (
              <MemberRow
                key={member.user.id}
                groupId={group.id}
                member={member}
                // Yourself you do not remove: you leave, below, if the server says you may.
                removable={group.canManage && member.user.id !== myId}
              />
            ))}
          </Stack>
        )}
      </Loaded>

      {group.canManage ? <AddMember groupId={group.id} /> : null}

      {group.canLeave ? (
        // What the group showed you goes with it: its plans and exercises, here and in the lists.
        <ConfirmButton
          title="Leave group"
          busy={leaving.busy}
          error={leaving.error}
          onConfirm={async () => {
            await leaving.submit(async () => {
              await leave.mutateAsync(group.id)
              goBack()
            })
          }}
          testID="group-leave"
        />
      ) : null}
    </Screen>
  )
}

function MemberRow({
  groupId,
  member,
  removable,
}: {
  readonly groupId: string
  readonly member: GroupMember
  readonly removable: boolean
}): React.JSX.Element {
  const remove = useRemoveMember(groupId)
  const { submit, busy, error } = useSubmit()
  return (
    <Stack gap="xs">
      <ListRow
        title={member.user.displayName}
        subtitle={`@${member.user.username}`}
        trailing={member.role}
        testID={`member-row-${member.user.username}`}
      />
      {removable ? (
        <ConfirmButton
          title={`Remove ${member.user.displayName}`}
          busy={busy}
          error={error}
          onConfirm={async () => {
            await submit(async () => {
              await remove.mutateAsync(member.user.id)
            })
          }}
          testID={`member-remove-${member.user.username}`}
        />
      ) : null}
    </Stack>
  )
}

/** By username — an account must exist to be added — as a reader or an editor. */
function AddMember({ groupId }: { readonly groupId: string }): React.JSX.Element {
  const add = useAddMember(groupId)
  const { submit, busy, error, fieldError } = useSubmit()
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<GroupRole>('reader')

  return (
    <Stack gap="sm">
      <Field label="Add a member" error={fieldError('username')}>
        <Input
          value={username}
          onChangeText={setUsername}
          placeholder="username"
          autoCapitalize="none"
          testID="member-username"
        />
      </Field>
      <Chips options={ROLE_OPTIONS} value={role} onChange={setRole} testID="member-role" />
      <Button
        title="Add"
        busy={busy}
        onPress={() => {
          void submit(async () => {
            await add.mutateAsync({ username, role })
            setUsername('')
          })
        }}
        testID="add-member"
      />
      <FormError message={error} testID="add-member-error" />
    </Stack>
  )
}
