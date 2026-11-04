# 0028 — Long text is Markdown, read in the contract and drawn by the app

**Status:** Accepted (2026-11-04). Changes the contract's dependency rule in
`docs/01-architecture.md`: its runtime dependencies were zod alone; they are zod and `marked`.

## Context

Long text is written by people and by an AI over MCP (#51), and the AI writes Markdown: a real
plan's notes came back as `## Effort`, `**2 reps in reserve**`, lists and a table, and the app
showed every mark as typed, in one paragraph above the plan. The same fields — workout notes, an
exercise's description and instructions, session notes, athlete notes, and a cue — reach the API,
MCP and the app alike, and are stored as text.

Drawing Markdown has two halves: reading it, and drawing what was read. Two ways to split them
were weighed:

- **A Markdown component** — `react-native-marked`, or the maintained fork of
  `react-native-markdown-display`. Each reads and draws inside its own components, with its own
  styles. A component is never unit-tested here (ADR-0017), so what is drawn — and what is never
  run — would have no test. Neither states react-native-web 0.21 or React 19 support; one drags in
  icon fonts and a syntax highlighter, and the other's table package has not changed since 2023.
- **A parser, and the app's own drawing** — the parser's tokens mapped to a small tree of what the
  app draws, in a plain module with its tests, and the tree drawn with the app's `Text` and `Stack`.

Of the parsers, `marked` (18.1.3) has no dependencies and is about 15 KB gzipped, with GFM tables
built in; `markdown-it` is about 41 KB with six dependencies; `micromark` with `mdast` is about
20 packages and needs two extensions for tables. All three ran under `bun test`, and `marked`
builds through Metro.

## Decision

**Long text is Markdown, stored as written. The contract reads it (`prose.ts`, with `marked`) into
a tree of what is drawn; the app draws that tree with its own primitives (`Prose`, `InlineProse`),
and can draw nothing else.**

- **The subset:** bold, italic, headings in two sizes, bulleted and numbered lists, GFM tables, and
  links to `http`, `https` and `mailto`. A single newline is a line break: a note typed on a phone
  means its lines.
- **Everything else is shown as it was written**, not dropped: HTML, images, code, quotes, rules,
  strikethrough, a task's box, and a link to any other address — `javascript:`, a relative path.
  Nothing written is lost, and nothing runs: there is no node in the tree that could.
- **A cue is one line** (GLOSSARY.md) and reads only bold, italic and links (`inlineProse`).
- **The tree lives in the contract**, beside the other pure functions the app draws from
  (`notesToKeep`, `musclesByLoad`), so the rules above are unit-tested and hold wherever the
  contract runs. `marked` is the contract's second runtime dependency: ESM, no dependencies, no
  runtime globals — `isomorphic.test.ts` names it.
- **MCP says so.** Each such field's description ends with what is drawn (`PROSE_WORDS`,
  `INLINE_PROSE_WORDS`), so the model writes what will render rather than guessing.

## Consequences

- The API, MCP and storage are unchanged: text in, text out. Only the app draws.
- `marked` is read through a type guard (`is` in `prose.ts`): its token union ends in a generic
  token any `type` may have, so a `switch` on `type` narrows nothing.
- A table is drawn column by column in a strip that scrolls sideways, one line per cell, so rows
  stay level without measuring; a cell that would wrap is cut instead.
- Text that only looked like plain text may now draw differently: a line opening `1.` or `- ` is a
  list, `#` and a space a heading, `*a*` italic. That is what an AI and most people mean by them.
- To revisit: a renderer that draws on web and native, is tested by its makers against both, and
  lets the app own every style — or a reason to draw images or code.
