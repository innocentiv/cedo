import { useState } from 'react'
import { aiClientConfigs } from '@cedo/contract'
import { Button, Card, Field, FormError, NavButton, Screen, Text } from '../../../src/ui/index.ts'
import { useCreateToken, useMcpAddress } from '../../../src/api/queries.ts'
import { useSubmit } from '../../../src/lib/use-submit.ts'

/** Every other client's setup, beside the two pasted here. */
const OTHER_CLIENTS_URL = 'https://github.com/innocentiv/cedo/blob/main/docs/07-mcp.md'

/** Until a token is made here, the snippets say where one goes. */
const TOKEN_PLACEHOLDER = '<your token>'

function Snippet({
  label,
  text,
  testID,
}: {
  readonly label: string
  readonly text: string
  readonly testID: string
}): React.JSX.Element {
  return (
    <Field label={label}>
      <Card testID={testID}>
        <Text variant="mono" selectable>
          {text}
        </Text>
      </Card>
    </Field>
  )
}

/**
 * Bring your own AI: the instance holds no model and no provider key, so an AI connects through
 * MCP with a token of yours. This screen says the address, makes the token, and writes the
 * configuration with both filled in — the snippets are the contract's (`connect.ts`).
 */
export default function ConnectAi(): React.JSX.Element {
  const create = useCreateToken()
  const { submit, busy, error } = useSubmit()
  const [token, setToken] = useState<string | null>(null)

  const address = useMcpAddress()
  const configs = aiClientConfigs(address, token ?? TOKEN_PLACEHOLDER)

  const add = () => {
    void submit(async () => {
      // No expiry, as on the tokens screen: revoke it there when this AI should stop.
      setToken((await create.mutateAsync({ name: 'Your AI', expiresInDays: null })).token)
    })
  }

  return (
    <Screen title="Connect your AI" testID="connect-screen">
      <Text tone="muted">
        Plan, review and adjust your training with your own AI assistant. It connects to this server
        over MCP, with a token that lets it act as you — exactly your permissions.
      </Text>

      <Snippet label="This server's MCP address" text={address} testID="mcp-address" />

      {token === null ? (
        <Button
          title="Create a token for your AI"
          onPress={add}
          busy={busy}
          testID="connect-create-token"
        />
      ) : (
        <Text variant="label" testID="connect-token-created">
          Token created and filled in below. Copy it now — it is never shown again.
        </Text>
      )}
      <FormError message={error} testID="connect-error" />

      <Snippet label="Claude Code" text={configs.claudeCode} testID="snippet-claude-code" />
      <Snippet
        label="Cursor, and other clients that read an mcpServers file"
        text={configs.json}
        testID="snippet-json"
      />

      <NavButton
        title="Setup for other clients"
        href={OTHER_CLIENTS_URL}
        testID="connect-other-clients"
      />
    </Screen>
  )
}
