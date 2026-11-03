import { useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  Card,
  Empty,
  Input,
  Loaded,
  NavButton,
  Screen,
  Stack,
  Text,
  useLayout,
} from '../../../src/ui/index.ts'
import { useExercises } from '../../../src/api/queries.ts'
import { ExerciseDetailView } from '../../../src/lib/exercise-detail.tsx'
import { ExerciseListRow } from '../../../src/lib/exercise-media.tsx'
import { EquipmentPrompt } from '../../../src/lib/doable-filter.tsx'
import { ExerciseFilters, useExerciseFilters } from '../../../src/lib/exercise-filters.tsx'
import { ShowMore } from '../../../src/lib/show-more.tsx'

/**
 * The exercise library (#27): searched, scoped, narrowed to a muscle. On a desktop the exercise
 * chosen opens beside the list (#29) — reading one and the next side by side; on a phone it is a
 * screen of its own. A filter that no longer lists the one open leaves it open: it is still being
 * read.
 */
export default function ExerciseList(): React.JSX.Element {
  const router = useRouter()
  const desk = useLayout() === 'tablet'
  const [search, setSearch] = useState('')
  const filters = useExerciseFilters()
  // In the address (`?open=`), so a reload or a link keeps it open (#29).
  const open = useLocalSearchParams<{ open?: string }>().open ?? null
  const setOpen = (id: string | null) => {
    router.setParams({ open: id ?? undefined })
  }

  const exercises = useExercises({
    limit: 50,
    ...filters.query,
    ...(search.trim() === '' ? {} : { q: search.trim() }),
  })

  const list = (
    <Stack gap="lg">
      <Stack gap="sm">
        <Input
          value={search}
          onChangeText={setSearch}
          placeholder="Search"
          testID="exercise-search"
        />
        <ExerciseFilters filters={filters} testID="exercise" />
      </Stack>
      {filters.doable.described === false ? <EquipmentPrompt /> : null}

      <Loaded query={exercises} testID="exercises">
        {(data) =>
          data.length === 0 ? (
            <Empty
              title="Nothing here yet"
              detail={search === '' ? 'Add one, or copy one from the shared library.' : 'No match.'}
              testID="exercises-empty"
            />
          ) : (
            <Stack gap="xs" testID="exercise-list">
              {data.map((exercise) => (
                <ExerciseListRow
                  key={exercise.id}
                  exercise={exercise}
                  tag={exercise.isFavourite ? 'Pinned' : undefined}
                  current={desk && open === exercise.id}
                  onPress={() => {
                    if (desk) setOpen(exercise.id)
                    else router.push(`/exercises/${exercise.id}`)
                  }}
                  testID={`exercise-row-${exercise.id}`}
                />
              ))}
              <ShowMore query={exercises} title="Show more exercises" testID="exercises-more" />
            </Stack>
          )
        }
      </Loaded>
    </Stack>
  )

  return (
    <Screen
      title="Exercises"
      testID="exercises-screen"
      footer={
        <NavButton
          title="New exercise"
          href="/exercises/new"
          variant="primary"
          testID="new-exercise"
        />
      }
      // Beside the list, each its own scroll: the exercise chosen low in it opens in view (#50).
      columns={{
        main: list,
        pane: (
          <Card testID="exercise-pane">
            {open === null ? (
              <Text tone="muted">Choose an exercise to see it here.</Text>
            ) : (
              <ExerciseDetailView
                key={open}
                id={open}
                pane
                onGone={() => {
                  setOpen(null)
                }}
              />
            )}
          </Card>
        ),
        chosen: open,
      }}
    />
  )
}
