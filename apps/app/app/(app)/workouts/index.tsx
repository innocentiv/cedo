import { useState } from 'react'
import { useRouter } from 'expo-router'
import type { WorkoutScope } from '@cedo/contract'
import {
  Button,
  Chips,
  Empty,
  Field,
  Input,
  ListRow,
  Loaded,
  Screen,
  Stack,
} from '../../../src/ui/index.ts'
import { useCreateWorkout, useWorkouts } from '../../../src/api/queries.ts'
import { useSubmit } from '../../../src/lib/use-submit.ts'

const SCOPES: readonly { value: WorkoutScope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'favourites', label: 'Pinned' },
]

export default function WorkoutList(): React.JSX.Element {
  const router = useRouter()
  const [scope, setScope] = useState<WorkoutScope>('all')
  const [name, setName] = useState('')
  const workouts = useWorkouts({ scope, limit: 50 })
  const create = useCreateWorkout()
  const { submit, busy, error: saveError } = useSubmit()

  const add = () => {
    void submit(async () => {
      const created = await create.mutateAsync({ name, notes: null })
      setName('')
      router.push(`/workouts/${created.id}/edit`)
    })
  }

  return (
    <Screen title="Workouts" testID="workouts-screen">
      <Chips options={SCOPES} value={scope} onChange={setScope} testID="workout-scope" />

      <Loaded query={workouts} testID="workouts">
        {(data) =>
          data.items.length === 0 ? (
            <Empty title="No plans yet" detail="Name one below to start." testID="workouts-empty" />
          ) : (
            <Stack gap="sm" testID="workout-list">
              {data.items.map((workout) => (
                <ListRow
                  key={workout.id}
                  title={workout.name}
                  subtitle={`${workout.dayCount} ${workout.dayCount === 1 ? 'day' : 'days'}`}
                  trailing={workout.isFavourite ? '★' : undefined}
                  onPress={() => {
                    router.push(`/workouts/${workout.id}`)
                  }}
                  testID={`workout-row-${workout.id}`}
                />
              ))}
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
