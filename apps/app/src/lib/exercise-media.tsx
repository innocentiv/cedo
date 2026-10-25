import { type Exercise, type Media, mainMuscles, videoThumbnailOf } from '@cedo/contract'
import { apiUrl } from '../api/http.ts'
import { ExerciseRow, VideoPlayer } from '../ui/index.ts'

/** A path the API answered — an upload's, relative to it — or a URL, made one the app can load. */
const loadable = (path: string | null): string | null => (path === null ? null : apiUrl(path))

/**
 * An exercise as a list shows it (#27) — the library, the picker: its name, its main muscles, and
 * its video's thumbnail. What the list adds — a tag, a check — is the list's.
 */
export function ExerciseListRow({
  exercise,
  tag,
  chosen,
  onPress,
  testID,
}: {
  readonly exercise: Exercise
  readonly tag?: string | undefined
  readonly chosen?: boolean
  readonly onPress: () => void
  readonly testID: string
}): React.JSX.Element {
  return (
    <ExerciseRow
      name={exercise.name}
      muscles={mainMuscles(exercise.muscles)}
      thumbnail={loadable(videoThumbnailOf(exercise))}
      tag={tag}
      chosen={chosen ?? false}
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
