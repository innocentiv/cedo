import { Lexer, type Token, type Tokens } from 'marked'

/**
 * Long text as the app draws it (#51, ADR-0028): workout notes, an exercise's description and
 * instructions, session and athlete notes — written by people and by an AI over MCP, which writes
 * Markdown. Stored as typed; only drawn as this.
 *
 * A small subset is marked — bold, italic, two sizes of heading, lists, tables, links to the web
 * and to mail — and everything else is the text it was written as: HTML, images, code, quotes,
 * rules, any other link. Nothing is dropped, and nothing runs: the app draws these nodes with its
 * own text, and has no way to draw anything else.
 *
 * `marked` reads the text; this decides what of it is drawn. A single newline is kept as one — a
 * note typed on a phone means its lines.
 */

export type ProseInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong' | 'em'; readonly children: readonly ProseInline[] }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly ProseInline[] }

export type ProseCell = readonly ProseInline[]

export type ProseBlock =
  | { readonly kind: 'paragraph'; readonly inline: readonly ProseInline[] }
  /** 1: a page's heading — `#` and `##`; 2: a section's — `###` and deeper. */
  | { readonly kind: 'heading'; readonly level: 1 | 2; readonly inline: readonly ProseInline[] }
  | {
      readonly kind: 'list'
      readonly ordered: boolean
      /** The first item's number; 1 for a bulleted list. */
      readonly start: number
      readonly items: readonly (readonly ProseBlock[])[]
    }
  | {
      readonly kind: 'table'
      readonly align: readonly ('left' | 'center' | 'right' | null)[]
      readonly head: readonly ProseCell[]
      readonly rows: readonly (readonly ProseCell[])[]
    }

/**
 * What a field drawn as prose tells the model that writes it (docs/07-mcp.md): its JSON Schema's
 * description, after what the field is for.
 */
export const PROSE_WORDS =
  'Markdown, drawn by the app: **bold**, *italic*, # headings, - and 1. lists, | tables |, ' +
  'and links to https or mailto. HTML, images and code are shown as written, not drawn.'

/** The same, for one line — a cue. */
export const INLINE_PROSE_WORDS =
  '**bold**, *italic* and links to https or mailto are drawn; nothing else is.'

const READING = { gfm: true, breaks: true } as const

/** The addresses a link may open: the web, and mail. Anything else is shown as written. */
const OPENS = /^(?:https?:|mailto:)/iu

/** Text in paragraphs: the whole subset. */
export function prose(source: string): ProseBlock[] {
  return blocksOf(Lexer.lex(source, READING))
}

/** One line — a cue: bold, italic and links; nothing that takes a line of its own. */
export function inlineProse(source: string): ProseInline[] {
  return inlinesOf(Lexer.lexInline(source, READING))
}

function blocksOf(tokens: readonly Token[]): ProseBlock[] {
  return tokens.flatMap((token) => blockOf(token))
}

function blockOf(token: Token): ProseBlock[] {
  if (token.type === 'space') return []
  if (is<Tokens.Paragraph>(token, 'paragraph')) {
    return [{ kind: 'paragraph', inline: inlinesOf(token.tokens) }]
  }
  // A tight list item's words, read as a paragraph.
  if (is<Tokens.Text>(token, 'text')) {
    return [{ kind: 'paragraph', inline: inlinesOf(token.tokens ?? [token]) }]
  }
  if (is<Tokens.Heading>(token, 'heading')) {
    return [{ kind: 'heading', level: token.depth <= 2 ? 1 : 2, inline: inlinesOf(token.tokens) }]
  }
  if (is<Tokens.List>(token, 'list')) {
    return [
      {
        kind: 'list',
        ordered: token.ordered,
        start: token.ordered && typeof token.start === 'number' ? token.start : 1,
        items: token.items.map((item) => itemOf(item)),
      },
    ]
  }
  if (is<Tokens.Table>(token, 'table')) {
    return [
      {
        kind: 'table',
        align: token.align,
        head: token.header.map((cell) => inlinesOf(cell.tokens)),
        rows: token.rows.map((row) => row.map((cell) => inlinesOf(cell.tokens))),
      },
    ]
  }
  return asWritten(token.raw)
}

/** A list item; a task's box said as it was written — `[ ] book the deload`. */
function itemOf(item: Tokens.ListItem): ProseBlock[] {
  const [first, ...rest] = item.tokens
  if (first?.type !== 'checkbox') return blocksOf(item.tokens)
  const blocks = blocksOf(rest)
  const [lead, ...after] = blocks
  const box = { kind: 'text', text: first.raw } as const
  if (lead?.kind !== 'paragraph') return [{ kind: 'paragraph', inline: [box] }, ...blocks]
  return [{ kind: 'paragraph', inline: merged([box, ...lead.inline]) }, ...after]
}

/** What the subset does not mark, as the paragraph it was written as — or nothing, if blank. */
function asWritten(raw: string): ProseBlock[] {
  const text = raw.trim()
  return text === '' ? [] : [{ kind: 'paragraph', inline: [{ kind: 'text', text }] }]
}

function inlinesOf(tokens: readonly Token[]): ProseInline[] {
  return merged(tokens.flatMap((token) => inlineOf(token)))
}

function inlineOf(token: Token): ProseInline[] {
  if (is<Tokens.Text>(token, 'text')) {
    return token.tokens === undefined
      ? [{ kind: 'text', text: token.text }]
      : token.tokens.flatMap((inner) => inlineOf(inner))
  }
  if (is<Tokens.Escape>(token, 'escape')) return [{ kind: 'text', text: token.text }]
  if (token.type === 'br') return [{ kind: 'text', text: '\n' }]
  if (is<Tokens.Strong>(token, 'strong')) {
    return [{ kind: 'strong', children: inlinesOf(token.tokens) }]
  }
  if (is<Tokens.Em>(token, 'em')) return [{ kind: 'em', children: inlinesOf(token.tokens) }]
  if (is<Tokens.Link>(token, 'link')) {
    return OPENS.test(token.href)
      ? [{ kind: 'link', href: token.href, children: inlinesOf(token.tokens) }]
      : [{ kind: 'text', text: token.raw }]
  }
  return [{ kind: 'text', text: token.raw }]
}

/**
 * A token of the kind its `type` names. `marked`'s union ends in a generic token any `type` may
 * have, so a `type` alone narrows nothing; each kind named here is one `marked` gives that shape.
 */
function is<T extends Token>(token: Token, type: T['type']): token is T {
  return token.type === type
}

/** Neighbouring text as one: what was split only by how it was read. */
function merged(inline: readonly ProseInline[]): ProseInline[] {
  const out: ProseInline[] = []
  for (const node of inline) {
    const last = out.at(-1)
    if (node.kind === 'text' && last?.kind === 'text') {
      out[out.length - 1] = { kind: 'text', text: last.text + node.text }
    } else {
      out.push(node)
    }
  }
  return out
}
