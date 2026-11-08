import { useState } from 'react'
import { Redirect, useRouter } from 'expo-router'
import { Button, Field, FormError, FrontDoor, Input, Stack } from '../../src/ui/index.ts'
import { useAuth } from '../../src/auth/auth-provider.tsx'
import { type Connection, addressOf } from '../../src/auth/server.ts'
import { useSubmit } from '../../src/lib/use-submit.ts'

/**
 * The native app's first screen (#78): which server. One build serves every instance (ADR-0032),
 * so a person types the address they open in a browser; `connect` checks it is cedo before it is
 * kept, and every rule is there (`src/auth/server.ts`) — this screen only says what came of it.
 * Changed from here too: the sign-in screen links back. The web app never sees it.
 */
export default function ServerScreen(): React.JSX.Element {
  const { server, connect } = useAuth()
  const router = useRouter()
  const [typed, setTyped] = useState(server.base === null ? '' : addressOf(server.base))
  const [refused, setRefused] = useState<string | null>(null)
  const { submit, busy, error } = useSubmit()
  if (server.status === 'served') return <Redirect href="/login" />

  const onConnect = (): void => {
    setRefused(null)
    void submit(async () => {
      const connection = await connect(typed)
      if (connection.kind === 'kept') router.replace('/login')
      else setRefused(said(connection))
    })
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
            onSubmitEditing={onConnect}
            testID="server-address"
          />
        </Field>
        <FormError message={refused ?? error} testID="server-problem" />
        <Button title="Connect" busy={busy} onPress={onConnect} testID="server-connect" />
      </Stack>
    </FrontDoor>
  )
}

/** Why a server was not kept, in a person's words. */
function said(connection: Exclude<Connection, { kind: 'kept' }>): string {
  switch (connection.kind) {
    case 'problem':
      return PROBLEM[connection.problem]
    case 'not-cedo':
      return 'A server answered there, but it is not cedo.'
    case 'elsewhere':
      return `That server sends cedo on to ${connection.host}. If that is yours, enter it instead.`
    case 'unreachable':
      return connection.onLocalNetwork
        ? 'Can’t reach your server. It is on your local network: allow cedo to find it, under Settings → Privacy & Security → Local Network.'
        : 'Can’t reach your server. Check the address, and that you have a signal.'
  }
}

const PROBLEM = {
  empty: 'Enter your server’s address.',
  malformed:
    'That is not an address. Enter it as you would in a browser: cedo.example.com, or 192.168.1.20:8080.',
  insecure:
    'That address needs https:// — the one you open cedo at in a browser works here too. Plain http:// is only for an IP address or a .local name: anywhere else your password would cross the network unprotected.',
} as const
