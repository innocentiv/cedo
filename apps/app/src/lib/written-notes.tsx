import { useState } from 'react'
import { notesToKeep } from '@cedo/contract'
import { Button, Folded, Input, Text } from '../ui/index.ts'

/**
 * Notes read first, and written on request (#51): whoever may change them sees them as everyone
 * else does, with Edit — so the writer reads what the reader will. Kept as the field is left, with
 * no Save, as before; what was kept shows at once, before the server's answer comes back.
 */
export function WrittenNotes({
  notes,
  onKeep,
  canEdit,
  placeholder,
  fold,
  testID,
}: {
  readonly notes: string | null
  /** A change worth sending: `notesToKeep`'s, never the same notes again. */
  readonly onKeep: (notes: string | null) => void
  readonly canEdit: boolean
  readonly placeholder: string
  /** The lines shown before Show all, where the notes would push what follows them away. */
  readonly fold?: number
  readonly testID: string
}): React.JSX.Element | null {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(notes ?? '')
  const [shown, setShown] = useState(notes)
  // Notes changed elsewhere — another tab, the AI — are shown, unless they are being written here.
  const [seen, setSeen] = useState(notes)
  if (notes !== seen && !editing) {
    setSeen(notes)
    setShown(notes)
    setDraft(notes ?? '')
  }

  if (editing) {
    return (
      <Input
        value={draft}
        onChangeText={setDraft}
        placeholder={placeholder}
        autoCapitalize="sentences"
        autoFocus
        multiline
        onBlur={() => {
          const kept = notesToKeep(draft, shown)
          if (kept !== undefined) {
            setShown(kept)
            onKeep(kept)
          }
          setEditing(false)
        }}
        testID={testID}
      />
    )
  }

  const edit = (title: string, id: string) => (
    <Button
      title={title}
      variant="ghost"
      size="small"
      onPress={() => {
        setEditing(true)
      }}
      testID={`${testID}-${id}`}
    />
  )
  if (shown === null) return canEdit ? edit('Add notes', 'add') : null
  return (
    <Folded
      lines={fold ?? Number.POSITIVE_INFINITY}
      actions={canEdit ? edit('Edit', 'edit') : undefined}
      testID={testID}
    >
      <Text testID={`${testID}-read`}>{shown}</Text>
    </Folded>
  )
}
