import { useState } from 'react'
import { type Exercise, type MuscleSlug, mainMuscles } from '@cedo/contract'
import { apiUrl } from '../api/http.ts'
import { useExercises, useRecentExercises } from '../api/queries.ts'
import {
  Button,
  Empty,
  ExerciseRow,
  Input,
  Loaded,
  MuscleFilter,
  Screen,
  Stack,
  Text,
} from '../ui/index.ts'

export interface ExercisePickerProps {
  /** The whole exercises, in the order picked — callers need their names and tracking modes. */
  readonly onPick: (exercises: readonly Exercise[]) => void
  readonly onCancel: () => void
  /** What the day already has: marked, still pickable — a second squat is a real plan. */
  readonly already?: ReadonlySet<string> | undefined
}

/**
 * Choosing exercises to add (#27): what was logged lately first, then the library — searched, or
 * narrowed to a muscle — each row its picture and what it mostly works. Several are picked at once,
 * in the order tapped, and added together.
 *
 * Rendered in place rather than pushed as a route: the page it adds to holds its own state, and
 * navigating away and back would lose it.
 */
export function ExercisePicker({
  onPick,
  onCancel,
  already,
}: ExercisePickerProps): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [muscle, setMuscle] = useState<MuscleSlug | null>(null)
  const [chosen, setChosen] = useState<readonly Exercise[]>([])
  const trimmed = search.trim()
  const narrowed = trimmed !== '' || muscle !== null
  const exercises = useExercises({
    scope: 'all',
    limit: 50,
    ...(trimmed === '' ? {} : { q: trimmed }),
    ...(muscle === null ? {} : { muscle }),
  })
  const recent = useRecentExercises()

  const toggle = (exercise: Exercise) => {
    setChosen((now) =>
      now.some((e) => e.id === exercise.id)
        ? now.filter((e) => e.id !== exercise.id)
        : [...now, exercise],
    )
  }
  const row = (exercise: Exercise, place: string) => (
    <ExerciseRow
      key={`${place}-${exercise.id}`}
      name={exercise.name}
      muscles={mainMuscles(exercise.muscles)}
      thumbnail={thumbnailOf(exercise)}
      tag={already?.has(exercise.id) === true ? 'In this day' : undefined}
      chosen={chosen.some((e) => e.id === exercise.id)}
      onPress={() => {
        toggle(exercise)
      }}
      testID={place === 'recent' ? `picker-recent-${exercise.id}` : `picker-row-${exercise.id}`}
    />
  )

  return (
    <Screen
      title="Add exercises"
      testID="exercise-picker"
      footer={
        <Stack direction="row" gap="sm">
          <Button
            title="Cancel"
            variant="secondary"
            grow
            onPress={onCancel}
            testID="picker-cancel"
          />
          <Button
            title={chosen.length === 0 ? 'Add' : `Add ${String(chosen.length)}`}
            grow
            disabled={chosen.length === 0}
            onPress={() => {
              onPick(chosen)
            }}
            testID="picker-add"
          />
        </Stack>
      }
    >
      <Stack direction="row" gap="sm" align="center">
        <Stack grow>
          <Input
            value={search}
            onChangeText={setSearch}
            placeholder="Search"
            autoFocus
            testID="picker-search"
          />
        </Stack>
        <MuscleFilter value={muscle} onChange={setMuscle} testID="picker-muscle" />
      </Stack>
      {narrowed || recent.data === undefined || recent.data.length === 0 ? null : (
        <Stack gap="xs" testID="picker-recent">
          <Text variant="label" tone="muted">
            Logged lately
          </Text>
          {recent.data.map((exercise) => row(exercise, 'recent'))}
        </Stack>
      )}
      <Loaded query={exercises} testID="picker">
        {(data) =>
          data.items.length === 0 ? (
            <Empty title="No match" testID="picker-empty" />
          ) : (
            <Stack gap="xs" testID="picker-library">
              {narrowed ? null : (
                <Text variant="label" tone="muted">
                  All exercises
                </Text>
              )}
              {data.items.map((exercise) => row(exercise, 'library'))}
            </Stack>
          )
        }
      </Loaded>
    </Screen>
  )
}

/** The first video's thumbnail, resolved against the API, or none. */
export const thumbnailOf = (exercise: Exercise): string | null => {
  const thumbnail = exercise.media.find((m) => m.thumbnailUrl !== null)?.thumbnailUrl ?? null
  return thumbnail === null ? null : apiUrl(thumbnail)
}
