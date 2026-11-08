/**
 * `bun run scripts/altstore-caddy.ts`, from `apps/app` — prints the Caddy line that sends
 * `/altstore/source.json` to the source of this checkout's version (#79), or nothing before the
 * first release. Run when the web image is built (apps/app/Dockerfile), so every instance offers
 * the iPhone app built beside it. What it prints is `altstore.ts`.
 */
import { VERSION } from '@cedo/contract'
import { caddyRedirect } from './altstore.ts'

console.log(caddyRedirect(VERSION))
