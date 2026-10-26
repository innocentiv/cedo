import { type WeightUnit, equipmentCount } from '@cedo/contract'
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
import { useEquipment } from '../../../src/api/equipment-queries.ts'
import { useRestAlerts } from '../../../src/lib/rest-alerts.ts'
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

        <RestAlertsSetting />

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

/** One line each: told when a rest is over, the app closed or not (#38). */
const ALERTS_SAID = {
  unsupported: 'Add cedo to your home screen to turn them on',
  ask: 'Off on this device',
  off: 'Off on this device',
  on: 'On for this device',
  blocked: "Blocked in this browser's settings",
} as const

const ON_OFF: readonly ChipOption<'on' | 'off'>[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
]

/** Rest alerts on this device (#38): what it is now, and turning it on or off. */
function RestAlertsSetting(): React.JSX.Element {
  const alerts = useRestAlerts()
  const { submit, error } = useSubmit()
  const switchable = alerts.state === 'ask' || alerts.state === 'off' || alerts.state === 'on'
  return (
    <Stack gap="sm">
      <ListRow title="Rest alerts" subtitle={ALERTS_SAID[alerts.state]} testID="settings-alerts" />
      {switchable ? (
        <Chips
          options={ON_OFF}
          value={alerts.state === 'on' ? 'on' : 'off'}
          onChange={(chosen) => {
            void submit(chosen === 'on' ? alerts.turnOn : alerts.turnOff)
          }}
          testID="rest-alerts"
        />
      ) : null}
      <FormError message={error} testID="rest-alerts-error" />
    </Stack>
  )
}
