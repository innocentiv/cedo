import { StyleSheet, View } from 'react-native'
import { METER_HEIGHT, color, radius } from './tokens.ts'

/**
 * How much, against the most (#28): a bar, its share of the track filled — a muscle's sets against
 * the most worked muscle's. Chalk; red, careful, for a muscle that declined.
 */
export function Meter({
  share,
  declined = false,
  testID,
}: {
  /** 0 to 1, as the contract works it out. */
  readonly share: number
  /** Half or less of the period before: said in red, careful. */
  readonly declined?: boolean
  readonly testID?: string | undefined
}): React.JSX.Element {
  return (
    <View style={styles.track} testID={testID}>
      <View
        style={[
          styles.fill,
          declined ? styles.declined : null,
          { width: `${String(Math.round(Math.min(Math.max(share, 0), 1) * 100))}%` },
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  track: {
    height: METER_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: color.surfaceRaised,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: color.textMuted },
  declined: { backgroundColor: color.danger },
})
