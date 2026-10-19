import type { WeightUnit } from '@cedo/contract'
import {
  Button,
  type ChipOption,
  Chips,
  FormError,
  ListRow,
  NavButton,
  Screen,
  Stack,
  Text,
} from '../../../src/ui/index.ts'
import { useAuth } from '../../../src/auth/auth-provider.tsx'
import { useSubmit } from '../../../src/lib/use-submit.ts'

const WEIGHT_UNITS: readonly ChipOption<WeightUnit>[] = [
  { value: 'kg', label: 'Kilograms' },
  { value: 'lb', label: 'Pounds' },
]

export default function Settings(): React.JSX.Element {
  const { me, signOut, setWeightUnit } = useAuth()
  const { submit, error } = useSubmit()

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
          <Chips
            options={WEIGHT_UNITS}
            value={me?.user.weightUnit ?? 'kg'}
            onChange={(unit) => {
              void submit(async () => {
                await setWeightUnit(unit)
              })
            }}
            testID="weight-unit"
          />
          <FormError message={error} testID="weight-unit-error" />
        </Stack>

        <Stack gap="sm">
          <ListRow
            title="Groups"
            subtitle={me === null ? undefined : `${me.groups.length} you belong to`}
            testID="settings-groups"
          />
          <NavButton title="Manage groups" href="/settings/groups" variant="secondary" />
        </Stack>

        <Stack gap="sm">
          <ListRow
            title="Access tokens"
            subtitle="For MCP clients, so an AI can act as you"
            testID="settings-tokens"
          />
          <NavButton title="Manage tokens" href="/settings/tokens" variant="secondary" />
        </Stack>

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
