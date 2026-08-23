import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native'
import { space } from './tokens.ts'

export interface StackProps {
  readonly direction?: 'row' | 'column'
  readonly gap?: keyof typeof space
  readonly align?: ViewStyle['alignItems']
  readonly justify?: ViewStyle['justifyContent']
  readonly wrap?: boolean
  readonly grow?: boolean
  readonly children?: React.ReactNode
  readonly testID?: string | undefined
  /** Escape hatch for layout only — never for colour, spacing or type. */
  readonly style?: StyleProp<ViewStyle>
}

/** Every layout in the app is a Stack. There is no other container. */
export function Stack({
  direction = 'column',
  gap = 'md',
  align,
  justify,
  wrap = false,
  grow = false,
  children,
  testID,
  style,
}: StackProps): React.JSX.Element {
  return (
    <View
      testID={testID}
      style={[
        styles.base,
        {
          flexDirection: direction,
          gap: space[gap],
          ...(align === undefined ? {} : { alignItems: align }),
          ...(justify === undefined ? {} : { justifyContent: justify }),
          flexWrap: wrap ? 'wrap' : 'nowrap',
          ...(grow ? { flex: 1 } : {}),
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

const styles = StyleSheet.create({ base: { minWidth: 0 } })
