# Dependencies

Every package this repository installs, why it is here, and where it comes from. `test/dependencies.test.ts`
fails on a package with no row, a row with no package, a **Where** that disagrees with the
`package.json` files, and an **Upstream** that is not the repository the installed package names.

**Before adding a package, check it is the one you meant.** A name an agent guesses may already be
registered by someone waiting for that guess. Look at its repository, its weekly downloads and the
date it was first published, then add its row in the same commit. Fewer is better: say what the
package does that a few lines of our own could not. The rule, and the release age that refuses a
version published in the last week, are in `docs/02-conventions.md`, "Dependencies".

**Where** is the workspace folder that installs it (`contract`, `api`, `app`), `root`, or
`override` for the root's `overrides`. A `workspace:` package is our own and has no row.

## Tooling, at the root

| Package | Where | Why | Upstream |
| --- | --- | --- | --- |
| `@types/bun` | root | Types for Bun's own APIs (`Bun.file`, `bun:test`, `Bun.WebView`) in every server-side project. | [DefinitelyTyped/DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| `knip` | root | Finds exports nobody imports, files nothing reaches and dependencies nothing uses, across the workspaces: `bun run deadcode` (`knip.jsonc`). oxlint sees one file at a time. | [webpro-nl/knip](https://github.com/webpro-nl/knip) |
| `oxfmt` | root | The formatter `bun run format` runs. | [oxc-project/oxc](https://github.com/oxc-project/oxc) |
| `oxlint` | root | The linter: the architecture's import bans and every rule written for the agent. | [oxc-project/oxc](https://github.com/oxc-project/oxc) |
| `oxlint-tsgolint` | root | oxlint's type-aware rules, run on the server (`.oxlintrc.typeaware.json`). | [oxc-project/tsgolint](https://github.com/oxc-project/tsgolint) |
| `typescript` | root, contract, api, app | The typecheck. TypeScript 7 on the server; 6 in the app, which Expo pins until 7.1 (`docs/adr/0007-typescript-version-split.md`). | [microsoft/TypeScript](https://github.com/microsoft/TypeScript) |

## The contract

| Package | Where | Why | Upstream |
| --- | --- | --- | --- |
| `marked` | contract | Reads the Markdown in notes and descriptions into the small set of nodes the app draws (`prose.ts`, ADR-0028). | [markedjs/marked](https://github.com/markedjs/marked) |
| `zod` | contract, api, app | Every shape, authored once in the contract (invariant 3); the API and the app parse with the same schemas. | [colinhacks/zod](https://github.com/colinhacks/zod) |

## The API

| Package | Where | Why | Upstream |
| --- | --- | --- | --- |
| `@elysia/openapi` | api | The API's OpenAPI document (`src/plugins/openapi.ts`). Elysia 2's plugins publish under `@elysia`; until 1.4 this was `@elysiajs/openapi`, from the same repository and maintainer. | [elysiajs/elysia-openapi](https://github.com/elysiajs/elysia-openapi) |
| `@modelcontextprotocol/server` | api | The MCP server an AI plans and reviews training through (`docs/07-mcp.md`). | [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) |
| `@types/node` | api | Types for the `node:` modules the API uses. | [DefinitelyTyped/DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| `drizzle-kit` | api | Writes migrations from the table definitions; `bun run db:studio`. | [drizzle-team/drizzle-orm](https://github.com/drizzle-team/drizzle-orm) |
| `drizzle-orm` | api | The table definitions and typed queries (`docs/05-database.md`). | [drizzle-team/drizzle-orm](https://github.com/drizzle-team/drizzle-orm) |
| `elysia` | api | The HTTP server (`docs/06-api.md`). | [elysiajs/elysia](https://github.com/elysiajs/elysia) |
| `postgres` | api | The Postgres driver Drizzle runs on. | [porsager/postgres](https://github.com/porsager/postgres) |

## The app

| Package | Where | Why | Upstream |
| --- | --- | --- | --- |
| `@bacons/apple-targets` | app | Builds the iOS widget extension that shows a rest's countdown as a Live Activity (`targets/rest-countdown`, #39). | [evanbacon/expo-apple-targets](https://github.com/evanbacon/expo-apple-targets) |
| `@expo-google-fonts/barlow` | app | The app's text face (`src/ui/fonts.ts`). | [expo/google-fonts](https://github.com/expo/google-fonts) |
| `@expo-google-fonts/barlow-condensed` | app | The app's display face (`src/ui/fonts.ts`). | [expo/google-fonts](https://github.com/expo/google-fonts) |
| `@expo/log-box` | app | A peer of `expo-router` and `@expo/metro-runtime`: the development error overlay. | [expo/expo](https://github.com/expo/expo) |
| `@expo/metro-runtime` | app | A peer of `expo` and `expo-router`: Metro's runtime in the bundle. | [expo/expo](https://github.com/expo/expo) |
| `@tanstack/react-query` | app | Server state on every screen: fetching, caching and invalidation. | [TanStack/query](https://github.com/TanStack/query) |
| `@types/react` | app | Types for React. | [DefinitelyTyped/DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| `expo` | app | The framework the app is built on (`docs/08-frontend.md`). | [expo/expo](https://github.com/expo/expo) |
| `expo-audio` | app | The chime at a rest's end (`src/lib/chime.ts`). | [expo/expo](https://github.com/expo/expo) |
| `expo-constants` | app | A peer of `expo-router`. | [expo/expo](https://github.com/expo/expo) |
| `expo-crypto` | app | Random values for a set's idempotency key; React Native has no `crypto` of its own (`src/lib/record-set.ts`). | [expo/expo](https://github.com/expo/expo) |
| `expo-dev-client` | app | The iOS development build (#77). | [expo/expo](https://github.com/expo/expo) |
| `expo-font` | app | Loads the two faces before the first screen draws. | [expo/expo](https://github.com/expo/expo) |
| `expo-haptics` | app | A rest's end felt as well as heard (`src/lib/chime.ts`). | [expo/expo](https://github.com/expo/expo) |
| `expo-image-picker` | app | A photo for an exercise (`src/lib/pick-image.ts`). | [expo/expo](https://github.com/expo/expo) |
| `expo-linking` | app | A peer of `expo-router`. | [expo/expo](https://github.com/expo/expo) |
| `expo-network` | app | Whether the phone has a signal, for sets logged without one (`src/api/device-state.ts`). | [expo/expo](https://github.com/expo/expo) |
| `expo-notifications` | app | Tells a rest's end when the app is not in front (`src/lib/rest-alert-device.ts`, #39). | [expo/expo](https://github.com/expo/expo) |
| `expo-router` | app | The routes, one file each under `app/`. | [expo/expo](https://github.com/expo/expo) |
| `expo-secure-store` | app | The session token, kept in the phone's Keychain (`src/auth/token-storage.ts`). | [expo/expo](https://github.com/expo/expo) |
| `react` | app | The UI library. | [react/react](https://github.com/react/react) |
| `react-dom` | app | Draws the web app; a peer of `expo-router` and `react-native-web`. | [react/react](https://github.com/react/react) |
| `react-native` | app | The UI runtime on the phone. | [react/react-native](https://github.com/react/react-native) |
| `react-native-gesture-handler` | app | A peer of `expo-router`. | [software-mansion/react-native-gesture-handler](https://github.com/software-mansion/react-native-gesture-handler) |
| `react-native-reanimated` | app | A peer of `expo-router`. | [software-mansion/react-native-reanimated](https://github.com/software-mansion/react-native-reanimated) |
| `react-native-safe-area-context` | app | Insets for the notch and the home indicator. | [appandflow/react-native-safe-area-context](https://github.com/appandflow/react-native-safe-area-context) |
| `react-native-screens` | app | A peer of `expo-router`: native screen containers. | [software-mansion/react-native-screens](https://github.com/software-mansion/react-native-screens) |
| `react-native-svg` | app | The icons and the brand mark (`src/ui/icon.tsx`, `src/ui/brand.tsx`). | [software-mansion/react-native-svg](https://github.com/software-mansion/react-native-svg) |
| `react-native-web` | app | Runs the app in a browser: the web app that installs to a home screen. | [necolas/react-native-web](https://github.com/necolas/react-native-web) |
| `react-native-worklets` | app, override | A peer of `react-native-reanimated`. The root override keeps one version across the tree: an older one nested a second React Native (CLAUDE.md, "After an Expo SDK upgrade"). | [software-mansion/react-native-reanimated](https://github.com/software-mansion/react-native-reanimated) |
