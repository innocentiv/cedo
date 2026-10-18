import { useState } from 'react'
import type { PersonalAccessToken } from '@cedo/contract'
import {
  Button,
  Card,
  Empty,
  Field,
  FormError,
  Input,
  ListRow,
  Loaded,
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

function TokenList({
  tokens,
  onRevoke,
}: {
  readonly tokens: readonly PersonalAccessToken[]
  readonly onRevoke: (id: string) => void
}): React.JSX.Element {
  if (tokens.length === 0) return <Empty title="No tokens yet" testID="tokens-empty" />
  return (
    <Stack gap="sm" testID="token-list">
      {tokens.map((token) => (
        <ListRow
          key={token.id}
          title={token.name}
          subtitle={
            token.lastUsedAt === null
              ? 'Never used'
              : `Last used ${new Date(token.lastUsedAt).toLocaleDateString()}`
          }
          trailing="Revoke"
          onPress={() => {
            onRevoke(token.id)
          }}
          testID={`token-row-${token.id}`}
        />
      ))}
    </Stack>
  )
}

export default function Tokens(): React.JSX.Element {
  const tokens = useTokens()
  const create = useCreateToken()
  const revoke = useRevokeToken()
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

      {secret === null ? null : <Secret token={secret} />}

      <Loaded query={tokens} testID="tokens">
        {(data) => (
          <TokenList
            tokens={data}
            onRevoke={(id) => {
              // Through `submit`, so a failed revoke SAYS so. Believing a credential is dead when
              // it is still live is the one mistake this screen must not let someone make.
              void submit(async () => {
                await revoke.mutateAsync(id)
              })
            }}
          />
        )}
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
