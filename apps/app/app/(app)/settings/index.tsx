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
import { useGroups } from '../../../src/api/queries.ts'
import { useAuth } from '../../../src/auth/auth-provider.tsx'
import { useSubmit } from '../../../src/lib/use-submit.ts'
import { useWeightUnit } from '../../../src/lib/weight-unit.ts'

const UNIT_OPTIONS: readonly ChipOption<WeightUnit>[] = [
  { value: 'kg', label: 'Kilograms' },
  { value: 'lb', label: 'Pounds' },
]

export default function Settings(): React.JSX.Element {
  const { me, signOut, setWeightUnit } = useAuth()
  const groups = useGroups()
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
          <Chips
            options={UNIT_OPTIONS}
            value={unit}
            onChange={(chosen) => {
              void submit(async () => {
                await setWeightUnit(chosen)
              })
            }}
            testID="weight-unit"
          />
          <FormError message={error} testID="weight-unit-error" />
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
