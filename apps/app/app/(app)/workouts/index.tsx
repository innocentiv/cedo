import { useState } from 'react'
import { useRouter } from 'expo-router'
import {
  Button,
  Empty,
  FilterRow,
  Field,
  Input,
  ListRow,
  Loaded,
  Screen,
  Stack,
} from '../../../src/ui/index.ts'
import { useCreateWorkout, useWorkouts } from '../../../src/api/queries.ts'
import { useGroupName } from '../../../src/lib/group-name.ts'
import { ALL, type ScopeChoice, ScopePicker } from '../../../src/lib/scope-picker.tsx'
import { ShowMore } from '../../../src/lib/show-more.tsx'
import { useSubmit } from '../../../src/lib/use-submit.ts'

export default function WorkoutList(): React.JSX.Element {
  const router = useRouter()
  const [scope, setScope] = useState<ScopeChoice>(ALL)
  const [name, setName] = useState('')
  const workouts = useWorkouts({ ...scope, limit: 50 })
  const create = useCreateWorkout()
  const groupNameOf = useGroupName()
  const { submit, busy, error: saveError } = useSubmit()

  const add = () => {
    void submit(async () => {
      const created = await create.mutateAsync({ name, notes: null })
      setName('')
      router.push(`/workouts/${created.id}`)
    })
  }

  return (
    <Screen title="Workouts" testID="workouts-screen">
      <FilterRow
        onClear={
          scope.scope === 'all'
            ? undefined
            : () => {
                setScope(ALL)
              }
        }
        testID="workout-filters"
      >
        <ScopePicker value={scope} onChange={setScope} testID="workout-scope" />
      </FilterRow>

      <Loaded query={workouts} testID="workouts">
        {(data) =>
          data.length === 0 ? (
            <Empty title="No plans yet" detail="Name one below to start." testID="workouts-empty" />
          ) : (
            <Stack gap="sm" testID="workout-list">
              {data.map((workout) => (
                <ListRow
                  key={workout.id}
                  title={workout.name}
                  subtitle={[
                    `${workout.dayCount} ${workout.dayCount === 1 ? 'day' : 'days'}`,
                    groupNameOf(workout.ownerGroupId),
                  ]
                    .filter((part) => part !== undefined)
                    .join(' · ')}
                  trailing={workout.isFavourite ? '★' : undefined}
                  onPress={() => {
                    router.push(`/workouts/${workout.id}`)
                  }}
                  testID={`workout-row-${workout.id}`}
                />
              ))}
              <ShowMore query={workouts} title="Show more workouts" testID="workouts-more" />
            </Stack>
          )
        }
      </Loaded>

      <Field label="New plan" error={saveError ?? undefined}>
        <Stack direction="row" gap="sm" align="center">
          <Stack grow>
            <Input
              value={name}
              onChangeText={setName}
              placeholder="Upper / Lower"
              autoCapitalize="sentences"
              testID="workout-name"
            />
          </Stack>
          <Button title="Create" onPress={add} busy={busy} testID="create-workout" />
        </Stack>
      </Field>
    </Screen>
  )
}
