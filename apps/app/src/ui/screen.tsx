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
  /**
   * A heading of the screen's own, in place of its title and Back — a name edited where it is read,
   * Today's date with the mark beside it. Laid out where a title is: atop the page's scroll on a
   * phone, pinned over both columns on a desktop.
   */
  readonly ownHeading?: React.ReactNode | undefined
  readonly scroll?: boolean
  /** Room for two `Columns` side by side on a desktop; one column on a phone either way. */
  readonly wide?: boolean
  /**
   * The screen's body as two columns (#50): on a desktop side by side under the title, each its own
   * scroll; on a phone the main then any side, one scroll as any screen. Wide, either way.
   * `children` still render — the sheets a screen opens, which take no place on it.
   */
  readonly columns?: ScreenColumns | undefined
  readonly testID?: string | undefined
}

/**
 * A screen's body as its two columns — see `Columns` for which is which. Beside the main, a `side`
 * that a phone shows under it, or a `pane` that only a desktop shows: a phone opens what it holds
 * elsewhere — a screen of its own, a sheet. Either `null`: nothing beside, the main alone in the
 * page's one scroll.
 */
export type ScreenColumns = {
  readonly main: React.ReactNode
  readonly narrow?: Narrow | undefined
} & (
  | { readonly side: React.ReactNode }
  | {
      readonly pane: React.ReactNode
      /**
       * What the pane shows, when it shows one thing chosen — an entry, an exercise, an athlete:
       * another chosen opens at the top of the pane, not wherever the last was scrolled to.
       */
      readonly chosen?: string | null | undefined
    }
)

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
  ownHeading,
  scroll = true,
  wide: wideAsked = false,
  columns,
  testID,
}: ScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets()
  const desk = useLayout() === 'tablet'
  const wide = wideAsked || columns !== undefined
  // What stands beside the main column here, if anything.
  const beside =
    (columns === undefined
      ? null
      : 'pane' in columns
        ? desk
          ? columns.pane
          : null
        : columns.side) ?? null
  const heading =
    ownHeading ??
    (onBack === undefined ? (
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
    ))
  const body = (
    <Stack gap="lg" grow>
      {heading}
      {columns === undefined ? null : beside === null ? (
        columns.main
      ) : (
        <Columns main={columns.main} side={beside} narrow={columns.narrow} />
      )}
      {children}
    </Stack>
  )

  const split = desk && columns !== undefined && beside !== null
  // A page that is one scroll runs under the status bar, as a native one does (#61): the room the
  // clock takes is the page's own once it scrolls. At rest the title sits just below the bar.
  const underBar = header === undefined && scroll && !split

  return (
    <View
      testID={testID}
      style={[styles.page, { paddingTop: header === undefined && !underBar ? insets.top : 0 }]}
    >
      {header}
      {split ? (
        // Two scrolls, not one: the page stays put, its title pinned above them (#50).
        <View style={styles.split}>
          {heading === null ? null : <View style={styles.heading}>{heading}</View>}
          <ScrollingColumns
            main={columns.main}
            side={beside}
            narrow={columns.narrow}
            chosen={'pane' in columns ? columns.chosen : undefined}
          />
          {children}
        </View>
      ) : scroll ? (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            wide ? styles.wide : null,
            underBar && insets.top > 0 ? { paddingTop: insets.top + space.sm } : null,
          ]}
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
      {underBar && insets.top > 0 ? (
        <View style={[styles.statusBar, { height: insets.top }]} />
      ) : null}
    </View>
  )
}

/**
 * Capped and centred. A form stretched across 1280px of tablet reads badly — the eye travels the
 * whole width for a field that needs a fifth of it — and this is the one place to say so, since
 * every route is a Screen.
 */
const centred = { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' } as const

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  content: { ...centred, flexGrow: 1, padding: space.lg, gap: space.lg },
  wide: { maxWidth: WIDE_CONTENT_MAX_WIDTH },
  /**
   * A desktop screen of two columns: the page's width and height, its padding left to each column's
   * own scroll (`ScrollingColumns`) but above the title.
   */
  split: { ...centred, flex: 1, maxWidth: WIDE_CONTENT_MAX_WIDTH },
  heading: { paddingHorizontal: space.lg, paddingTop: space.lg },
  /** Over what scrolls beneath the clock; a tap there reaches the page, as if it were not there. */
  statusBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: color.statusBar,
    pointerEvents: 'none',
  },
  footer: {
    ...centred,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.bg,
  },
})
