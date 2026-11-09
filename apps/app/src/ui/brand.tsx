import { StyleSheet, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import {
  BRAND_MARK_SIZE,
  DOOR_MAX_WIDTH,
  NUMERAL_METRICS,
  brand,
  space,
  type as typeScale,
} from './tokens.ts'
import { Screen } from './screen.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'

/**
 * The mark (#61): a yellow plate face on, its steel insert at the hub, and a wedge of shadow across
 * its right side that opens it into the c of cedo. The same drawing as `public/icons/icon.svg`, on
 * the same 512 grid, less the square of floor the icon fills: here the floor is the page's own.
 * Decorative: the name is always written beside it.
 */
function BrandMark({ size }: { readonly size: keyof typeof BRAND_MARK_SIZE }): React.JSX.Element {
  const side = BRAND_MARK_SIZE[size]
  return (
    <Svg width={side} height={side} viewBox="0 0 512 512">
      <Circle cx={256} cy={256} r={180} fill={brand.plate} />
      <Path d="M256 256 L393.9 140.3 A180 180 0 0 1 393.9 371.7 Z" fill={brand.shadow} />
      <Circle
        cx={256}
        cy={256}
        r={138}
        fill="none"
        stroke={brand.floor}
        strokeOpacity={0.22}
        strokeWidth={8}
      />
      <Circle cx={256} cy={256} r={50} fill={brand.insert} />
      <Circle cx={256} cy={256} r={30} fill={brand.floor} />
    </Svg>
  )
}

/**
 * Where a title's capitals sit, measured down from the top of its line box: half the leading the
 * line box adds or takes away, then the ascent, less half a capital.
 */
const title = typeScale.title
const capCentre =
  (title.lineHeight - (NUMERAL_METRICS.ascent + NUMERAL_METRICS.descent) * title.fontSize) / 2 +
  (NUMERAL_METRICS.ascent - NUMERAL_METRICS.capHeight / 2) * title.fontSize

/**
 * A title with the mark beside it — Today's date on a phone, the product's name atop a desktop's
 * sidebar. The mark centres on the capitals of the title's first line, not on its line box, which
 * keeps room below them for descenders: centred on the box, the plate sat high of the letters.
 * `mark` false: the title alone, where the mark is on the screen already — Today on a desktop,
 * beside the sidebar's.
 */
export function BrandHeading({
  text,
  mark = true,
  testID,
}: {
  readonly text: string
  readonly mark?: boolean
  readonly testID?: string | undefined
}): React.JSX.Element {
  return (
    <View style={styles.heading}>
      {mark ? (
        <View style={styles.headingMark}>
          <BrandMark size="heading" />
        </View>
      ) : null}
      <Stack grow>
        <Text variant="title" accessibilityRole="header" testID={testID}>
          {text}
        </Text>
      </Stack>
    </View>
  )
}

/**
 * The way in (#61) — signing in, registering: the mark large and the name under it, a line of what
 * cedo is, and the form below; one narrow column, a little above the middle of the screen.
 */
export function FrontDoor({
  children,
  testID,
}: {
  readonly children: React.ReactNode
  readonly testID: string
}): React.JSX.Element {
  return (
    <Screen testID={testID}>
      <View style={styles.door}>
        <View style={styles.above}>
          <BrandMark size="door" />
          <Text variant="wordmark" accessibilityRole="header">
            cedo
          </Text>
          {/* One line on a phone; wrapped, never cut, on the narrowest. */}
          <Text variant="caption" tone="faint" align="center">
            Your workouts, your plans, on your own server.
          </Text>
        </View>
        {children}
        <View style={styles.below} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  headingMark: { marginTop: capCentre - BRAND_MARK_SIZE.heading / 2 },
  door: {
    flexGrow: 1,
    width: '100%',
    maxWidth: DOOR_MAX_WIDTH,
    alignSelf: 'center',
    gap: space.lg,
  },
  // What is left of the screen, shared two to three above the form and below it: the brand stands
  // a little above the middle, as it does on a native app's sign-in.
  above: {
    flexGrow: 2,
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: space.sm,
    paddingBottom: space.xl,
  },
  below: { flexGrow: 3 },
})
