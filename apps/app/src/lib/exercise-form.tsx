import { useState } from 'react'
import {
  type EquipmentSlug,
  type Exercise,
  type ExerciseInput,
  type Media,
  type MuscleLoad,
  TRACKING_MODES,
  type TrackingMode,
  exerciseInputFrom,
} from '@cedo/contract'
import {
  Button,
  Chips,
  EquipmentPicker,
  Field,
  FormError,
  Input,
  MusclePicker,
  Screen,
} from '../ui/index.ts'
import { MediaLinks } from './media-links.tsx'
import { useGoBack } from './use-go-back.ts'
import { useSubmit } from './use-submit.ts'

const TRACKING_LABELS: Record<TrackingMode, string> = {
  weight_reps: 'Weight × reps',
  bodyweight_reps: 'Bodyweight',
  duration: 'Duration',
  distance_duration: 'Distance',
}

const TRACKING_OPTIONS = TRACKING_MODES.map((value) => ({
  value,
  label: TRACKING_LABELS[value],
}))

export interface ExerciseFormProps {
  readonly title: string
  readonly initial?: Exercise | undefined
  readonly onSave: (input: ExerciseInput) => Promise<void>
  readonly testID: string
}

/**
 * Create and edit are the same form. Splitting them duplicates every field and they drift — one
 * gaining a control the other never gets. The only difference is what it starts from.
 */
export function ExerciseForm({
  title,
  initial,
  onSave,
  testID,
}: ExerciseFormProps): React.JSX.Element {
  const goBack = useGoBack('/exercises')
  const [name, setName] = useState(initial?.name ?? '')
  const [tracking, setTracking] = useState<TrackingMode>(initial?.tracking ?? 'weight_reps')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [instructions, setInstructions] = useState(initial?.instructions ?? '')
  const [equipment, setEquipment] = useState<EquipmentSlug[] | null>(initial?.equipment ?? null)
  const [muscles, setMuscles] = useState<MuscleLoad[]>(
    initial?.muscles.map((m) => ({ ...m })) ?? [],
  )
  const [media, setMedia] = useState<Media[]>(initial?.media ?? [])
  const { submit, busy, error, fieldError } = useSubmit()

  const save = () => {
    void submit(async () => {
      // From the exercise as it is, when editing one: what the form has no control for — whether
      // it is done one side at a time — is carried, not restated; creating, the schema defaults it.
      await onSave({
        ...(initial === undefined ? {} : exerciseInputFrom(initial)),
        name,
        tracking,
        description,
        instructions,
        equipment,
        muscles,
        mediaIds: media.map((m) => m.id),
      })
      goBack()
    })
  }

  return (
    <Screen
      title={title}
      testID={testID}
      footer={<Button title="Save" onPress={save} busy={busy} testID={`${testID}-save`} />}
    >
      <Field label="Name" error={fieldError('name')}>
        <Input
          value={name}
          onChangeText={setName}
          autoCapitalize="sentences"
          testID="exercise-name"
        />
      </Field>

      <Field label="Tracking">
        <Chips
          options={TRACKING_OPTIONS}
          value={tracking}
          onChange={setTracking}
          testID="exercise-tracking"
        />
      </Field>

      <Field label="Equipment" error={fieldError('equipment')}>
        <EquipmentPicker value={equipment} onChange={setEquipment} />
      </Field>

      <Field label="Muscles" error={fieldError('muscles')}>
        <MusclePicker value={muscles} onChange={setMuscles} />
      </Field>

      <Field label="Media" error={fieldError('mediaIds')}>
        <MediaLinks value={media} onChange={setMedia} />
      </Field>

      <Field label="Description" error={fieldError('description')}>
        <Input
          value={description}
          onChangeText={setDescription}
          multiline
          autoCapitalize="sentences"
          testID="exercise-description"
        />
      </Field>

      <Field label="How to" error={fieldError('instructions')}>
        <Input
          value={instructions}
          onChangeText={setInstructions}
          multiline
          autoCapitalize="sentences"
          testID="exercise-instructions-input"
        />
      </Field>

      <FormError message={error} testID={`${testID}-error`} />
    </Screen>
  )
}
