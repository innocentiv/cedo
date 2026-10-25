import { useState } from 'react'
import { useRouter } from 'expo-router'
import { type MuscleSlug, type OwnableScope, mainMuscles } from '@cedo/contract'
import {
  Chips,
  Empty,
  ExerciseRow,
  Input,
  Loaded,
  MuscleFilter,
  NavButton,
  Screen,
  Stack,
  Text,
} from '../../../src/ui/index.ts'
import { useExercises } from '../../../src/api/queries.ts'
import { thumbnailOf } from '../../../src/lib/exercise-picker.tsx'

const SCOPES: readonly { value: OwnableScope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'favourites', label: 'Pinned' },
]

export default function ExerciseList(): React.JSX.Element {
  const router = useRouter()
  const [scope, setScope] = useState<OwnableScope>('all')
  const [search, setSearch] = useState('')
  const [muscle, setMuscle] = useState<MuscleSlug | null>(null)

  const query = {
    scope,
    limit: 50,
    ...(search.trim() === '' ? {} : { q: search.trim() }),
    ...(muscle === null ? {} : { muscle }),
  }
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
      </Stack>

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
                <ExerciseRow
                  key={exercise.id}
                  name={exercise.name}
                  muscles={mainMuscles(exercise.muscles)}
                  thumbnail={thumbnailOf(exercise)}
                  tag={exercise.isFavourite ? 'Pinned' : undefined}
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
