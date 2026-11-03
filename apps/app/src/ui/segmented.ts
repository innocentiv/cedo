import { StyleSheet } from 'react-native'
import { color, radius, stroke } from './tokens.ts'

/**
 * One look for a row of segments: reps in reserve (`ReserveChips`), a list's filters (`FilterRow`).
 * Said once, so the two never drift apart. Each segment after the first draws the line before it.
 */
export const segmented = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: stroke.hairline,
    borderColor: color.border,
    overflow: 'hidden',
  },
  divided: { borderLeftWidth: stroke.hairline, borderLeftColor: color.border },
})
