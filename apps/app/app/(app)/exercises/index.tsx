import { useState } from 'react'
import { useRouter } from 'expo-router'
import { MUSCLES } from '@cedo/contract'
import type { ExerciseScope } from '@cedo/contract'
import {
  Empty,
  Input,
  ListRow,
  Loaded,
  NavButton,
  Screen,
  Stack,
  Text,
} from '../../../src/ui/index.ts'
import { Chips } from '../../../src/ui/chips.tsx'
import { useExercises } from '../../../src/api/queries.ts'

const SCOPES: readonly { value: ExerciseScope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'favourites', label: 'Pinned' },
]

const muscleName = (slug: string): string => MUSCLES.find((m) => m.slug === slug)?.name ?? slug

export default function ExerciseList(): React.JSX.Element {
  const router = useRouter()
  const [scope, setScope] = useState<ExerciseScope>('all')
  const [search, setSearch] = useState('')

  const query = { scope, limit: 50, ...(search.trim() === '' ? {} : { q: search.trim() }) }
  const exercises = useExercises(query)

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
    >
      <Input
        value={search}
        onChangeText={setSearch}
        placeholder="Search"
        testID="exercise-search"
      />
      <Chips options={SCOPES} value={scope} onChange={setScope} testID="exercise-scope" />

      <Loaded query={exercises} testID="exercises">
        {(data) =>
          data.items.length === 0 ? (
            <Empty
              title="Nothing here yet"
              detail={search === '' ? 'Add one, or copy one from the shared library.' : 'No match.'}
              testID="exercises-empty"
            />
          ) : (
            <Stack gap="sm" testID="exercise-list">
              {data.items.map((exercise) => (
                <ListRow
                  key={exercise.id}
                  title={exercise.name}
                  subtitle={exercise.muscles.map((m) => muscleName(m.muscle)).join(', ')}
                  trailing={exercise.isFavourite ? '★' : undefined}
                  onPress={() => {
                    router.push(`/exercises/${exercise.id}`)
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
    </Screen>
  )
}
