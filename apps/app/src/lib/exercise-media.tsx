import {
  type Exercise,
  MISSING_EQUIPMENT,
  type Media,
  mainMuscles,
  videoThumbnailOf,
} from '@cedo/contract'
import { apiUrl } from '../api/http.ts'
import { ExerciseRow, VideoPlayer } from '../ui/index.ts'
import { useOwnerName } from './owner-name.ts'

/** A path the API answered — an upload's, relative to it — or a URL, made one the app can load. */
const loadable = (path: string | null): string | null => (path === null ? null : apiUrl(path))

/**
 * An exercise as a list shows it (#27) — the library, the picker: its name, the group that owns it
 * (#47), its main muscles, and its video's thumbnail. What the list adds — a tag, a check — is the
 * list's.
 */
export function ExerciseListRow({
  exercise,
  tag,
  chosen,
  current,
  onPress,
  testID,
}: {
  readonly exercise: Exercise
  readonly tag?: string | undefined
  readonly chosen?: boolean
  readonly current?: boolean
  readonly onPress: () => void
  readonly testID: string
}): React.JSX.Element {
  const owner = useOwnerName()(exercise.ownerGroupId)
  // Not doable: said when the list holds everything, and in a plan, where it is never hidden (#35).
  const tags = [owner, exercise.doable ? undefined : MISSING_EQUIPMENT, tag].filter(
    (t) => t !== undefined,
  )
  return (
    <ExerciseRow
      name={exercise.name}
      muscles={mainMuscles(exercise.muscles)}
      thumbnail={loadable(videoThumbnailOf(exercise))}
      tag={tags.length === 0 ? undefined : tags.join(' · ')}
      chosen={chosen ?? false}
      current={current ?? false}
      onPress={onPress}
      testID={testID}
    />
  )
}

/** An exercise's video, played where it is shown (#27) — its page, How to. */
export function ExerciseVideo({
  video,
  label,
  testID,
}: {
  readonly video: Media
  readonly label: string
  readonly testID: string
}): React.JSX.Element {
  return (
    <VideoPlayer
      embedUrl={video.embedUrl}
      thumbnail={loadable(video.thumbnailUrl)}
      url={video.url}
      label={video.title === '' ? label : video.title}
      testID={testID}
    />
  )
}

export { loadable }
