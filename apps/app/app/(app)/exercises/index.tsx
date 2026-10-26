import { useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { MuscleSlug, OwnableScope } from '@cedo/contract'
import {
  Card,
  Chips,
  Columns,
  Empty,
  Input,
  Loaded,
  MuscleFilter,
  NavButton,
  Screen,
  Stack,
  Text,
  useLayout,
} from '../../../src/ui/index.ts'
import { useExercises } from '../../../src/api/queries.ts'
import { ExerciseDetailView } from '../../../src/lib/exercise-detail.tsx'
import { ExerciseListRow } from '../../../src/lib/exercise-media.tsx'
import { DoableChips, EquipmentPrompt, useDoableFilter } from '../../../src/lib/doable-filter.tsx'

const SCOPES: readonly { value: OwnableScope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'favourites', label: 'Pinned' },
]

/**
 * The exercise library (#27): searched, scoped, narrowed to a muscle. On a desktop the exercise
 * chosen opens beside the list (#29) — reading one and the next side by side; on a phone it is a
 * screen of its own. A filter that no longer lists the one open leaves it open: it is still being
 * read.
 */
export default function ExerciseList(): React.JSX.Element {
  const router = useRouter()
  const desk = useLayout() === 'tablet'
  const [scope, setScope] = useState<OwnableScope>('all')
  const [search, setSearch] = useState('')
  const [muscle, setMuscle] = useState<MuscleSlug | null>(null)
  // In the address (`?open=`), so a reload or a link keeps it open (#29).
  const open = useLocalSearchParams<{ open?: string }>().open ?? null
  const setOpen = (id: string | null) => {
    router.setParams({ open: id ?? undefined })
  }

  const doable = useDoableFilter()
  const query = {
    scope,
    limit: 50,
    ...doable.query,
    ...(search.trim() === '' ? {} : { q: search.trim() }),
    ...(muscle === null ? {} : { muscle }),
  }
  const exercises = useExercises(query)

  const list = (
    <Stack gap="lg">
      <Stack gap="sm">
        <Input
          value={search}
          onChangeText={setSearch}
          placeholder="Search"
          testID="exercise-search"
        />
        <Stack direction="row" align="center" gap="sm" wrap>
          <Chips options={SCOPES} value={scope} onChange={setScope} testID="exercise-scope" />
          <MuscleFilter value={muscle} onChange={setMuscle} testID="exercise-muscle" />
        </Stack>
        <DoableChips filter={doable} testID="exercise-showing" />
      </Stack>
      {doable.described === false ? <EquipmentPrompt /> : null}

      <Loaded query={exercises} testID="exercises">
        {(data) =>
          data.items.length === 0 ? (
            <Empty
              title="Nothing here yet"
              detail={search === '' ? 'Add one, or copy one from the shared library.' : 'No match.'}
              testID="exercises-empty"
            />
          ) : (
            <Stack gap="xs" testID="exercise-list">
              {data.items.map((exercise) => (
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
              {data.nextCursor === null ? null : (
                <Text variant="caption" tone="faint" align="center">
                  {`Showing the first ${data.items.length}. Narrow the search to see more.`}
                </Text>
              )}
            </Stack>
          )
        }
      </Loaded>
    </Stack>
  )

  return (
    <Screen
      title="Exercises"
      wide
      testID="exercises-screen"
      footer={
        <NavButton
          title="New exercise"
          href="/exercises/new"
          variant="primary"
          testID="new-exercise"
        />
      }
    >
      {desk ? (
        <Columns
          main={list}
          side={
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
          }
        />
      ) : (
        list
      )}
    </Screen>
  )
}
