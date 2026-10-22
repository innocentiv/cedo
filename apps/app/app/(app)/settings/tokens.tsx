import { useState } from 'react'
import type { PersonalAccessToken } from '@cedo/contract'
import {
  Button,
  Card,
  ConfirmButton,
  Empty,
  Field,
  FormError,
  Input,
  ListRow,
  Loaded,
  NavButton,
  Screen,
  Stack,
  Text,
} from '../../../src/ui/index.ts'
import { useCreateToken, useRevokeToken, useTokens } from '../../../src/api/queries.ts'
import { useSubmit } from '../../../src/lib/use-submit.ts'

/** Shown exactly once, at creation. The API stores only a hash, so it cannot be recovered. */
function Secret({ token }: { readonly token: string }): React.JSX.Element {
  return (
    <Card testID="token-secret">
      <Stack gap="xs">
        <Text variant="label" tone="success">
          Copy this now — it is never shown again.
        </Text>
        <Text variant="mono" selectable>
          {token}
        </Text>
      </Stack>
    </Card>
  )
}

/** A token, and Revoke — asked twice: a client using it loses access, and nothing gives it back. */
function TokenRow({ token }: { readonly token: PersonalAccessToken }): React.JSX.Element {
  const revoke = useRevokeToken()
  // Through `submit`, so a failed revoke SAYS so. Believing a credential is dead when it is still
  // live is the one mistake this screen must not let someone make.
  const { submit, busy, error } = useSubmit()
  return (
    <Stack gap="xs">
      <ListRow
        title={token.name}
        subtitle={
          token.lastUsedAt === null
            ? 'Never used'
            : `Last used ${new Date(token.lastUsedAt).toLocaleDateString()}`
        }
        testID={`token-row-${token.id}`}
      />
      <ConfirmButton
        title="Revoke"
        busy={busy}
        error={error}
        onConfirm={async () => {
          await submit(async () => {
            await revoke.mutateAsync(token.id)
          })
        }}
        testID={`token-revoke-${token.id}`}
      />
    </Stack>
  )
}

function TokenList({
  tokens,
}: {
  readonly tokens: readonly PersonalAccessToken[]
}): React.JSX.Element {
  if (tokens.length === 0) return <Empty title="No tokens yet" testID="tokens-empty" />
  return (
    <Stack gap="sm" testID="token-list">
      {tokens.map((token) => (
        <TokenRow key={token.id} token={token} />
      ))}
    </Stack>
  )
}

export default function Tokens(): React.JSX.Element {
  const tokens = useTokens()
  const create = useCreateToken()
  const { submit, busy, error } = useSubmit()
  const [name, setName] = useState('')
  const [secret, setSecret] = useState<string | null>(null)

  const add = () => {
    void submit(async () => {
      // This screen offers no expiry; a token made here lasts until it is revoked.
      setSecret((await create.mutateAsync({ name, expiresInDays: null })).token)
      setName('')
    })
  }

  return (
    <Screen title="Access tokens" testID="tokens-screen">
      <Text tone="muted">
        A token lets an MCP client act as you, with exactly your permissions. Paste it into the
        client's configuration.
      </Text>

      <NavButton
        title="Connect your AI"
        href="/settings/connect"
        variant="secondary"
        testID="tokens-connect-ai"
      />

      {secret === null ? null : <Secret token={secret} />}

      <Loaded query={tokens} testID="tokens">
        {(data) => <TokenList tokens={data} />}
      </Loaded>

      <Field label="New token">
        <Stack direction="row" gap="sm" align="center">
          <Stack grow>
            <Input value={name} onChangeText={setName} placeholder="claude" testID="token-name" />
          </Stack>
          <Button title="Create" onPress={add} busy={busy} testID="create-token" />
        </Stack>
      </Field>

      <FormError message={error} testID="tokens-error" />
    </Screen>
  )
}
