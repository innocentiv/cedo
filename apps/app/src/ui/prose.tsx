import { useMemo } from 'react'
import { Linking, Text as RNText, ScrollView, StyleSheet } from 'react-native'
import {
  type ProseBlock,
  type ProseCell,
  type ProseInline,
  inlineProse,
  prose,
} from '@cedo/contract'
import { Stack } from './stack.tsx'
import { Text, type Tone } from './text.tsx'
import { color, font } from './tokens.ts'

/**
 * Long text, drawn (#51, ADR-0028): a workout's notes, an exercise's instructions — what the
 * contract's `prose` reads of it, and nothing else. Selectable: notes are copied out.
 */
export function Prose({
  text,
  tone = 'default',
  testID,
}: {
  readonly text: string
  readonly tone?: Tone
  readonly testID?: string | undefined
}): React.JSX.Element {
  const blocks = useMemo(() => prose(text), [text])
  return (
    <Stack gap="sm" testID={testID}>
      {blocks.map((block, at) => (
        <Block key={at} block={block} tone={tone} />
      ))}
    </Stack>
  )
}

/** One line — a cue: bold, italic and links, in the text it sits in. */
export function InlineProse({
  text,
  variant = 'body',
  tone = 'default',
  testID,
}: {
  readonly text: string
  readonly variant?: 'body' | 'label'
  readonly tone?: Tone
  readonly testID?: string | undefined
}): React.JSX.Element {
  const inline = useMemo(() => inlineProse(text), [text])
  return (
    <Text variant={variant} tone={tone} selectable testID={testID}>
      <Spans inline={inline} />
    </Text>
  )
}

function Block({
  block,
  tone,
}: {
  readonly block: ProseBlock
  readonly tone: Tone
}): React.JSX.Element {
  switch (block.kind) {
    case 'paragraph': {
      return (
        <Text tone={tone} selectable>
          <Spans inline={block.inline} />
        </Text>
      )
    }
    case 'heading': {
      return (
        <Text variant={block.level === 1 ? 'heading' : 'label'} selectable>
          <Spans inline={block.inline} />
        </Text>
      )
    }
    case 'list': {
      return (
        <Stack gap="xs">
          {block.items.map((item, at) => (
            <Stack key={at} direction="row" gap="sm">
              <Text tone="muted">{block.ordered ? `${String(block.start + at)}.` : '•'}</Text>
              <Stack gap="xs" grow>
                {item.map((inner, i) => (
                  <Block key={i} block={inner} tone={tone} />
                ))}
              </Stack>
            </Stack>
          ))}
        </Stack>
      )
    }
    case 'table': {
      return <Table block={block} tone={tone} />
    }
  }
}

/**
 * A table, column by column, in a strip of its own that scrolls sideways — the page never does. A
 * cell is one line here, so a column laid out as one keeps every row level.
 */
function Table({
  block,
  tone,
}: {
  readonly block: Extract<ProseBlock, { kind: 'table' }>
  readonly tone: Tone
}): React.JSX.Element {
  const cell = (inline: ProseCell, head: boolean, align: 'left' | 'center' | 'right') => (
    <Text
      variant={head ? 'label' : 'body'}
      tone={head ? 'muted' : tone}
      align={align}
      selectable
      numberOfLines={1}
    >
      <Spans inline={inline} />
    </Text>
  )
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <Stack direction="row" gap="lg">
        {block.head.map((head, column) => {
          const align = block.align[column] ?? 'left'
          return (
            <Stack key={column} gap="xs" align={COLUMN[align]}>
              {cell(head, true, align)}
              {block.rows.map((row, at) => (
                <Stack key={at}>{cell(row[column] ?? [], false, align)}</Stack>
              ))}
            </Stack>
          )
        })}
      </Stack>
    </ScrollView>
  )
}

/** Inline marks, nested in the text they sit in: it sets their size and colour. */
function Spans({ inline }: { readonly inline: readonly ProseInline[] }): React.JSX.Element {
  return (
    <>
      {inline.map((node, at) => {
        switch (node.kind) {
          case 'text': {
            return node.text
          }
          case 'strong':
          case 'em': {
            return (
              <RNText key={at} style={node.kind === 'strong' ? styles.strong : styles.em}>
                <Spans inline={node.children} />
              </RNText>
            )
          }
          default: {
            return (
              <RNText
                key={at}
                accessibilityRole="link"
                style={styles.link}
                onPress={() => {
                  void Linking.openURL(node.href)
                }}
              >
                <Spans inline={node.children} />
              </RNText>
            )
          }
        }
      })}
    </>
  )
}

const COLUMN = { left: 'flex-start', center: 'center', right: 'flex-end' } as const

const styles = StyleSheet.create({
  strong: { fontFamily: font.semibold },
  em: { fontStyle: 'italic' },
  link: { color: color.accent, textDecorationLine: 'underline' },
})
