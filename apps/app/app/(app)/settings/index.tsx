import { useState } from 'react'
import { type SignUp, VERSION, type WeightUnit, equipmentCount } from '@cedo/contract'
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
import { type VersionNotice, hostOf, versionNotice } from '../../../src/auth/server.ts'
import { useSubmit } from '../../../src/lib/use-submit.ts'
import { useWeightUnit } from '../../../src/lib/weight-unit.ts'
import {
  type AlertKind,
  tellsWhileClosed,
  useAlertKind,
  useChooseAlertKind,
} from '../../../src/lib/rest-alert-device.ts'

const UNIT_OPTIONS: readonly ChoiceOption<WeightUnit>[] = [
  { value: 'kg', label: 'Kilograms' },
  { value: 'lb', label: 'Pounds' },
]

const ALERT_OPTIONS: readonly ChoiceOption<AlertKind>[] = [
  { value: 'off', label: 'Off' },
  { value: 'notification', label: 'Notification' },
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

        {tellsWhileClosed ? <RestAlertSetting /> : null}

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

        <ServerSetting />

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

/**
 * How this phone tells a rest's end with cedo closed (#39): kept on the phone, which alone knows
 * what iOS allows it. The native app's only — a home-screen web app cannot be told anything closed.
 */
function RestAlertSetting(): React.JSX.Element {
  const chosen = useAlertKind()
  const { choose, refused } = useChooseAlertKind()
  return (
    <Stack gap="sm">
      <ListRow
        title="Rest over"
        subtitle="How this phone tells you, with cedo closed"
        testID="settings-rest-alert"
      />
      <Choice options={ALERT_OPTIONS} value={chosen} onChange={choose} testID="rest-alert-kind" />
      <FormError message={refused} testID="rest-alert-error" />
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

/**
 * On native, which server — read here only; changing it is done signed out, from the sign-in
 * screen — and this app's version beside the server's (#78). A difference is said, never refused
 * (ADR-0032), naming the side to update. The web app is its server's own, so never shows it.
 */
function ServerSetting(): React.JSX.Element | null {
  const { server } = useAuth()
  const instance = useInstance()
  // The web app keeps no server: its page is its server's own.
  if (server.base === null) return null
  const notice = instance.data === undefined ? null : versionNotice(VERSION, instance.data.version)
  return (
    <Stack gap="sm">
      <ListRow title="Server" subtitle={hostOf(server.base)} testID="settings-server" />
      <Text tone={notice === null ? 'faint' : 'default'} testID="settings-version">
        {instance.isError
          ? `This app is cedo ${VERSION}. Your server did not say which it is: update the older one.`
          : notice === null
            ? `cedo ${VERSION}`
            : versionSaid(notice)}
      </Text>
    </Stack>
  )
}

function versionSaid({ app, server, update }: NonNullable<VersionNotice>): string {
  if (update === 'app')
    return `This app is cedo ${app}, and your server ${server}: update this app.`
  if (update === 'server') {
    return `Your server is cedo ${server}, and this app ${app}: update the server.`
  }
  return `This app is cedo ${app}, and your server ${server}: update the older one.`
}
