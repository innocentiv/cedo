import { useState } from 'react'
import type { Exercise } from '@cedo/contract'
import { useExercises, useRecentExercises } from '../api/queries.ts'
import { ExerciseListRow } from './exercise-media.tsx'
import { ExerciseFilters, useExerciseFilters } from './exercise-filters.tsx'
import { ShowMore } from './show-more.tsx'
import { Button, Empty, Input, Loaded, Screen, Stack, Text } from '../ui/index.ts'

export interface ExercisePickerProps {
  /** The whole exercises, in the order picked — callers need their names and tracking modes. */
  readonly onPick: (exercises: readonly Exercise[]) => void
  readonly onCancel: () => void
  /** What the day already has: marked, still pickable — a second squat is a real plan. */
  readonly already?: ReadonlySet<string> | undefined
}

/**
 * Choosing exercises to add (#27): what was logged lately first, then the library — searched, or
 * narrowed to a muscle, and only what your equipment lets you do unless asked for everything (#35)
 * — each row its picture and what it mostly works. Several are picked at once,
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
  const [chosen, setChosen] = useState<readonly Exercise[]>([])
  const filters = useExerciseFilters()
  const trimmed = search.trim()
  // Searched, or narrowed to a group or a muscle: what was logged lately is not what was asked for.
  const narrowed = trimmed !== '' || filters.scope.scope !== 'all' || filters.muscle !== null
  const exercises = useExercises({
    limit: 50,
    ...filters.query,
    ...(trimmed === '' ? {} : { q: trimmed }),
  })
  const recent = useRecentExercises()

  const toggle = (exercise: Exercise) => {
    setChosen((now) =>
      now.some((e) => e.id === exercise.id)
        ? now.filter((e) => e.id !== exercise.id)
        : [...now, exercise],
    )
  }
  // Logged lately and in the library both: told apart by their test ids, which must not repeat.
  const row = (exercise: Exercise, lately: boolean) => (
    <ExerciseListRow
      key={`${lately ? 'lately' : 'library'}-${exercise.id}`}
      exercise={exercise}
      tag={already?.has(exercise.id) === true ? 'In this day' : undefined}
      chosen={chosen.some((e) => e.id === exercise.id)}
      onPress={() => {
        toggle(exercise)
      }}
      testID={lately ? `picker-recent-${exercise.id}` : `picker-row-${exercise.id}`}
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
      <Input
        value={search}
        onChangeText={setSearch}
        placeholder="Search"
        autoFocus
        testID="picker-search"
      />
      <ExerciseFilters filters={filters} testID="picker" />
      {narrowed || recent.data === undefined || recent.data.length === 0 ? null : (
        <Stack gap="xs" testID="picker-recent">
          <Text variant="label" tone="muted">
            Logged lately
          </Text>
          {recent.data.map((exercise) => row(exercise, true))}
        </Stack>
      )}
      <Loaded query={exercises} testID="picker">
        {(data) =>
          data.pages[0]?.items.length === 0 ? (
            <Empty title="No match" testID="picker-empty" />
          ) : (
            <Stack gap="xs" testID="picker-library">
              {narrowed ? null : (
                <Text variant="label" tone="muted">
                  All exercises
                </Text>
              )}
              {data.pages.flatMap((page) => page.items).map((exercise) => row(exercise, false))}
              <ShowMore query={exercises} title="Show more exercises" testID="picker-more" />
            </Stack>
          )
        }
      </Loaded>
    </Screen>
  )
}
