import { useState } from 'react'
import { useRouter } from 'expo-router'
import {
  Button,
  Empty,
  Field,
  FormError,
  Input,
  ListRow,
  Loaded,
  Screen,
  Stack,
  Text,
} from '../../../../src/ui/index.ts'
import { useCreateGroup, useGroups } from '../../../../src/api/queries.ts'
import { useSubmit } from '../../../../src/lib/use-submit.ts'

export default function Groups(): React.JSX.Element {
  const router = useRouter()
  const groups = useGroups()
  const create = useCreateGroup()
  const { submit, busy, error } = useSubmit()
  const [name, setName] = useState('')

  const add = () => {
    void submit(async () => {
      await create.mutateAsync({ name })
      setName('')
    })
  }

  return (
    <Screen title="Groups" testID="groups-screen">
      <Text tone="muted">
        Everything you own belongs to a group. Your personal one is private; shared groups let other
        people read or edit what is in them.
      </Text>

      <Loaded query={groups} testID="groups">
        {(data) =>
          data.length === 0 ? (
            <Empty title="No groups" testID="groups-empty" />
          ) : (
            <Stack gap="sm" testID="group-list">
              {data.map((group) => (
                <ListRow
                  key={group.id}
                  title={group.name}
                  subtitle={
                    group.kind === 'personal'
                      ? 'Personal'
                      : `Shared · ${group.memberCount} ${group.memberCount === 1 ? 'member' : 'members'}`
                  }
                  trailing={group.role}
                  onPress={() => {
                    router.push(`/settings/groups/${group.id}`)
                  }}
                  testID={`group-row-${group.id}`}
                />
              ))}
            </Stack>
          )
        }
      </Loaded>

      <Field label="New group">
        <Stack direction="row" gap="sm" align="center">
          <Stack grow>
            <Input value={name} onChangeText={setName} placeholder="Squad" testID="group-name" />
          </Stack>
          <Button title="Create" onPress={add} busy={busy} testID="create-group" />
        </Stack>
      </Field>

      <FormError message={error} testID="groups-error" />
    </Screen>
  )
}
