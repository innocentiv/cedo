import { useState } from 'react'
import { Platform } from 'react-native'
import { Redirect, useRouter } from 'expo-router'
import { Button, Field, FormError, FrontDoor, Input, Stack } from '../../src/ui/index.ts'
import { useAuth } from '../../src/auth/auth-provider.tsx'
import {
  type AddressProblem,
  type ServerCheck,
  checkServer,
  readAddress,
} from '../../src/auth/server.ts'

/**
 * The native app's first screen (#78): which server. One build serves every instance (ADR-0032),
 * so a person types the address they open in a browser; it is checked to be cedo before it is
 * kept, and changed from here too — the sign-in screen links back. The web app is served by its
 * own server, and never sees this screen.
 */
export default function ServerScreen(): React.JSX.Element {
  const { server, chooseServer } = useAuth()
  const router = useRouter()
  // Changing server starts from the one kept, as it was typed less the API's own path.
  const [typed, setTyped] = useState(server.base?.replace(/\/api$/u, '') ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (Platform.OS === 'web') return <Redirect href="/login" />

  const connect = async (): Promise<void> => {
    const read = readAddress(typed)
    if ('problem' in read) {
      setProblem(ADDRESS[read.problem])
      return
    }
    setBusy(true)
    setProblem(null)
    const found = await checkServer(read.base, fetch)
    if (found.kind !== 'cedo') {
      setBusy(false)
      setProblem(answer(found))
      return
    }
    await chooseServer(read.base)
    router.replace('/login')
  }

  return (
    <FrontDoor testID="server-screen">
      <Stack gap="lg">
        <Field label="Your server" hint="The address you open cedo at in a browser.">
          <Input
            value={typed}
            onChangeText={setTyped}
            placeholder="cedo.example.com"
            inputMode="url"
            autoFocus
            onSubmitEditing={() => {
              void connect()
            }}
            testID="server-address"
          />
        </Field>
        <FormError message={problem} testID="server-problem" />
        <Button
          title="Connect"
          busy={busy}
          onPress={() => {
            void connect()
          }}
          testID="server-connect"
        />
      </Stack>
    </FrontDoor>
  )
}

const ADDRESS: Readonly<Record<AddressProblem, string>> = {
  empty: 'Enter your server’s address.',
  malformed:
    'That is not an address. Enter it as you would in a browser: cedo.example.com, or 192.168.1.20:8080.',
  insecure:
    'That address needs https://. Plain http:// is only for an IP address or a .local name: anywhere else your password would cross the network unprotected.',
}

/** What the check found, when it is not cedo. */
function answer(found: Exclude<ServerCheck, { kind: 'cedo' }>): string {
  if (found.kind === 'not-cedo') return 'A server answered there, but it is not cedo.'
  if (found.kind === 'elsewhere') {
    return `That server sends cedo on to ${found.host}. If that is yours, enter it instead.`
  }
  return found.onLocalNetwork
    ? 'Can’t reach your server. It is on your local network: allow cedo to find it, under Settings → Privacy & Security → Local Network.'
    : 'Can’t reach your server. Check the address, and that you have a signal.'
}
