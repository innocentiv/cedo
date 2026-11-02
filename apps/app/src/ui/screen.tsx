import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CONTENT_MAX_WIDTH, WIDE_CONTENT_MAX_WIDTH, color, space } from './tokens.ts'
import { Columns, type Narrow, ScrollingColumns } from './columns.tsx'
import { IconButton } from './icon.tsx'
import { Stack } from './stack.tsx'
import { Text } from './text.tsx'
import { useLayout } from './use-layout.ts'

export interface ScreenProps {
  readonly title?: string | undefined
  readonly children?: React.ReactNode
  /** Pinned to the bottom, outside the scroll area — where a primary action belongs. */
  readonly footer?: React.ReactNode | undefined
  /** Pinned to the top, outside the scroll area, in place of the title — a session's own header. */
  readonly header?: React.ReactNode | undefined
  /**
   * A way back beside the title, for a screen reached from another with no other way out — an
   * installed app on a desktop has no browser Back.
   */
  readonly onBack?: (() => void) | undefined
  readonly scroll?: boolean
  /** Room for two `Columns` side by side on a desktop; one column on a phone either way. */
  readonly wide?: boolean
  /**
   * The screen's body as two columns (#50): on a desktop side by side under the title, each its own
   * scroll; on a phone the main then the side, one scroll as any screen. Wide, either way.
   * `children` still render — the sheets a screen opens, which take no place on it.
   */
  readonly columns?: ScreenColumns | undefined
  readonly testID?: string | undefined
}

/** A screen's body as its two columns — see `Columns` for which is which. */
export interface ScreenColumns {
  readonly main: React.ReactNode
  readonly side: React.ReactNode
  readonly narrow?: Narrow | undefined
  /**
   * What the side shows, when it shows one thing chosen — an entry, an exercise, an athlete: another
   * chosen opens at the top of the side, not wherever the last was scrolled to.
   */
  readonly chosen?: string | null | undefined
}

/**
 * The outermost element of every route. Owns safe-area insets, the page background and the one
 * horizontal padding value, so no screen sets any of them. See docs/08-frontend.md.
 */
export function Screen({
  title,
  children,
  footer,
  header,
  onBack,
  scroll = true,
  wide: wideAsked = false,
  columns,
  testID,
}: ScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const desk = useLayout() === 'tablet'
  const wide = wideAsked || columns !== undefined
  const heading =
    onBack === undefined ? (
      title === undefined ? null : (
        <Text variant="title">{title}</Text>
      )
    ) : (
      <Stack direction="row" align="center" gap="sm">
        <IconButton
          name="back"
          label="Back"
          edge="start"
          tone="default"
          onPress={onBack}
          // The screen's own: a stack keeps the screens behind mounted, each with its Back.
          testID={`${testID ?? 'screen'}-back`}
        />
        <Stack grow>
          <Text variant="title">{title ?? ''}</Text>
        </Stack>
      </Stack>
    )
  const body = (
    <Stack gap="lg" grow>
      {heading}
      {columns === undefined ? null : (
        <Columns main={columns.main} side={columns.side} narrow={columns.narrow} />
      )}
      {children}
    </Stack>
  )

  return (
    <View
      testID={testID}
      style={[styles.page, { paddingTop: header === undefined ? insets.top : 0 }]}
    >
      {header}
      {desk && columns !== undefined ? (
        // Two scrolls, not one: the page stays put, its title pinned above them (#50).
        <View style={styles.split}>
          {heading === null ? null : <View style={styles.heading}>{heading}</View>}
          <ScrollingColumns
            main={columns.main}
            side={columns.side}
            narrow={columns.narrow}
            chosen={columns.chosen}
          />
          {children}
        </View>
      ) : scroll ? (
        <ScrollView
          contentContainerStyle={[styles.content, wide ? styles.wide : null]}
          keyboardShouldPersistTaps="handled"
          testID="screen-scroll"
        >
          {body}
        </ScrollView>
      ) : (
        <View style={[styles.content, wide ? styles.wide : null]}>{body}</View>
      )}
      {footer === undefined ? null : (
        <View
          style={[
            styles.footer,
            wide ? styles.wide : null,
            { paddingBottom: insets.bottom + space.md },
          ]}
        >
          {footer}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  /**
   * Capped and centred. A form stretched across 1280px of tablet reads badly — the eye travels the
   * whole width for a field that needs a fifth of it — and this is the one place to say so, since
   * every route is a Screen.
   */
  content: {
    flexGrow: 1,
    padding: space.lg,
    gap: space.lg,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  wide: { maxWidth: WIDE_CONTENT_MAX_WIDTH },
  /**
   * A desktop screen of two columns: the page's width and height, its padding left to each column's
   * own scroll (`ScrollingColumns`) but above the title.
   */
  split: {
    flex: 1,
    width: '100%',
    maxWidth: WIDE_CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  heading: { paddingHorizontal: space.lg, paddingTop: space.lg },
  footer: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.bg,
  },
})
