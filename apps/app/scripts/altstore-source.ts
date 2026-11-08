/**
 * `bun run scripts/altstore-source.ts <built .app> <.ipa>`, from `apps/app`, on macOS — prints the
 * AltStore source a release carries (#79), from the built app's own Info.plist and the `.ipa`'s
 * size and digest. Run by `build-ipa.sh`; what it writes is `altstore.ts`.
 */
import { VERSION } from '@cedo/contract'
import { $ } from 'bun'
import { AppInfo, sourceFor } from './altstore.ts'

const [app, ipa] = Bun.argv.slice(2)
if (app === undefined || ipa === undefined) {
  console.error('Usage: bun run scripts/altstore-source.ts <built .app> <.ipa>')
  process.exit(1)
}

const info = AppInfo.parse(await $`plutil -convert json -o - ${app}/Info.plist`.json())
const bytes = await Bun.file(ipa).bytes()

const source = sourceFor({
  info,
  ipa: { size: bytes.length, sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex') },
  version: VERSION,
  date: new Date().toISOString().slice(0, 10),
})
console.log(JSON.stringify(source, null, 2))
