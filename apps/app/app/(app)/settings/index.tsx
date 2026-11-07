import { useState } from 'react'
import { type SignUp, type WeightUnit, equipmentCount } from '@cedo/contract'
import {
  Button,
  type ChoiceOption,
  Choice,
  FormError,
  ListRow,
  NavButton,
  NumberInput,
  Screen,
  Stack,
  Text,
} from '../../../src/ui/index.ts'
import { useGroups, useInstance, useSetSignUp } from '../../../src/api/queries.ts'
import { useEquipment } from '../../../src/api/equipment-queries.ts'
import { useAuth } from '../../../src/auth/auth-provider.tsx'
import { useSubmit } from '../../../src/lib/use-submit.ts'
import { useWeightUnit } from '../../../src/lib/weight-unit.ts'

const UNIT_OPTIONS: readonly ChoiceOption<WeightUnit>[] = [
  { value: 'kg', label: 'Kilograms' },
  { value: 'lb', label: 'Pounds' },
]

const SIGN_UP_OPTIONS: readonly ChoiceOption<SignUp>[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
]

export default function Settings(): React.JSX.Element {
  const { me, signOut, updateAccount } = useAuth()
  const groups = useGroups()
  const equipment = useEquipment()
  const { submit, error } = useSubmit()
  const unit = useWeightUnit()

  return (
    <Screen title="Settings" testID="settings-screen">
      <Stack gap="lg">
        <Text tone="muted">{me === null ? '' : `Signed in as ${me.user.displayName}`}</Text>

        <Stack gap="sm">
          <ListRow
            title="Weights"
            subtitle="How weights read and are typed"
            testID="settings-weights"
          />
          <Choice
            options={UNIT_OPTIONS}
            value={unit}
            onChange={(chosen) => {
              void submit(async () => {
                await updateAccount({ weightUnit: chosen })
              })
            }}
            testID="weight-unit"
          />
          <FormError message={error} testID="weight-unit-error" />
        </Stack>

        <BirthYear />

        <Stack gap="sm">
          <ListRow
            title="Equipment"
            subtitle={equipment.data === undefined ? undefined : equipmentCount(equipment.data)}
            testID="settings-equipment"
          />
          <NavButton
            title="Your equipment"
            href="/settings/equipment"
            variant="secondary"
            testID="manage-equipment"
          />
        </Stack>

        <Stack gap="sm">
          <ListRow
            title="Groups"
            // The groups read, not the sign-in's snapshot of them: creating or leaving one
            // refreshes this, and nothing refreshes that.
            subtitle={groups.data === undefined ? undefined : `${groups.data.length} you belong to`}
            testID="settings-groups"
          />
          <NavButton
            title="Manage groups"
            href="/settings/groups"
            variant="secondary"
            testID="manage-groups"
          />
        </Stack>

        <Stack gap="sm">
          <ListRow
            title="Access tokens"
            subtitle="For MCP clients, so an AI can act as you"
            testID="settings-tokens"
          />
          <NavButton
            title="Connect your AI"
            href="/settings/connect"
            variant="secondary"
            testID="connect-ai"
          />
          <NavButton
            title="Manage tokens"
            href="/settings/tokens"
            variant="secondary"
            testID="manage-tokens"
          />
        </Stack>

        {me?.curator === true ? <SignUpSetting /> : null}

        <Button
          title="Sign out"
          variant="danger"
          onPress={() => {
            void signOut()
          }}
          testID="sign-out"
        />
      </Stack>
    </Screen>
  )
}

/**
 * The curator's switch (#71): open sign-up while testers register, then close it. Shown only to the
 * curator, as `Me.curator` says; the server refuses anyone else.
 */
function SignUpSetting(): React.JSX.Element {
  const instance = useInstance()
  const setSignUp = useSetSignUp()
  const { submit, error } = useSubmit()
  return (
    <Stack gap="sm">
      <ListRow
        title="Sign-up"
        subtitle="Whether anyone who reaches this instance can create an account"
        testID="settings-sign-up"
      />
      {instance.data === undefined ? null : (
        <Choice
          options={SIGN_UP_OPTIONS}
          value={instance.data.signUp}
          onChange={(chosen) => {
            void submit(async () => {
              await setSignUp.mutateAsync(chosen)
            })
          }}
          testID="sign-up"
        />
      )}
      <FormError message={error} testID="sign-up-error" />
    </Stack>
  )
}

/** The year they were born (#42), kept for whoever plans their training — empty to forget it. */
function BirthYear(): React.JSX.Element {
  const { me, updateAccount } = useAuth()
  const saved = me?.user.birthYear ?? null
  const [year, setYear] = useState(saved)
  const { submit, busy, error } = useSubmit()
  return (
    <Stack gap="sm">
      <ListRow
        title="Year of birth"
        subtitle="So whoever plans your training knows your age"
        testID="settings-birth-year"
      />
      <Stack direction="row" gap="sm" align="center">
        <Stack grow>
          <NumberInput value={year} onChange={setYear} placeholder="1990" testID="birth-year" />
        </Stack>
        <Button
          title="Save"
          variant="secondary"
          disabled={year === saved}
          busy={busy}
          onPress={() => {
            void submit(async () => {
              await updateAccount({ birthYear: year })
            })
          }}
          testID="birth-year-save"
        />
      </Stack>
      <FormError message={error} testID="birth-year-error" />
    </Stack>
  )
}
