import { type AthleteNote, noteByline } from '@cedo/contract'

/**
 * Athlete notes (#41), compact for the model to read: `Coach Kim · Mon 12 Oct · <id>`, then its
 * words indented beneath — a note's id is what `note_update` takes. Newest first, as written.
 */
export const noteLines = (notes: readonly AthleteNote[], readerId: string): string =>
  notes.length === 0
    ? 'No notes yet.'
    : notes
        .map((n) => `${noteByline(n, readerId)} · ${n.id}\n  ${n.text.replaceAll('\n', '\n  ')}`)
        .join('\n\n')
