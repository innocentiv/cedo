import { Card, Empty, ListRow, Loaded, Screen, Stack, Text } from '../../../src/ui/index.ts'
import { useGroups } from '../../../src/api/queries.ts'

export default function Groups(): React.JSX.Element {
  const groups = useGroups()

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
            <Card testID="group-list">
              <Stack gap="xs">
                {data.map((group) => (
                  <ListRow
                    key={group.id}
                    title={group.name}
                    subtitle={group.kind === 'personal' ? 'Personal' : 'Shared'}
                    trailing={group.role}
                    testID={`group-row-${group.id}`}
                  />
                ))}
              </Stack>
            </Card>
          )
        }
      </Loaded>
    </Screen>
  )
}
