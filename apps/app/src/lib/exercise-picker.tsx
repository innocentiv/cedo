import { useState } from 'react'
import { Button, Empty, Input, ListRow, Loaded, Screen, Stack } from '../ui/index.ts'
import { useExercises } from '../api/queries.ts'

export interface ExercisePickerProps {
  readonly onPick: (exerciseId: string) => void
  readonly onCancel: () => void
}

/**
 * Choosing an exercise to add to a plan.
 *
 * Rendered in place rather than pushed as a route: the plan editor holds unsaved state, and
 * navigating away and back would either lose it or force it somewhere it does not belong.
 */
export function ExercisePicker({ onPick, onCancel }: ExercisePickerProps): React.JSX.Element {
  const [search, setSearch] = useState('')
  const trimmed = search.trim()
  const exercises = useExercises({
    scope: 'all',
    limit: 50,
    ...(trimmed === '' ? {} : { q: trimmed }),
  })

  return (
    <Screen
      title="Pick an exercise"
      testID="exercise-picker"
      footer={
        <Button title="Cancel" variant="secondary" onPress={onCancel} testID="picker-cancel" />
      }
    >
      <Input
        value={search}
        onChangeText={setSearch}
        placeholder="Search"
        autoFocus
        testID="picker-search"
      />
      <Loaded query={exercises} testID="picker">
        {(data) =>
          data.items.length === 0 ? (
            <Empty title="No match" testID="picker-empty" />
          ) : (
            <Stack gap="sm">
              {data.items.map((exercise) => (
                <ListRow
                  key={exercise.id}
                  title={exercise.name}
                  subtitle={exercise.equipment ?? undefined}
                  onPress={() => {
                    onPick(exercise.id)
                  }}
                  testID={`picker-row-${exercise.id}`}
                />
              ))}
            </Stack>
          )
        }
      </Loaded>
    </Screen>
  )
}
