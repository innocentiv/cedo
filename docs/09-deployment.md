# Deployment

Three containers, **one published port**. Verified from a clean `docker compose up --build`.

```
                    :8080
                      │
                 ┌────▼─────┐
                 │   web    │  Caddy: static export + /api proxy
                 └────┬─────┘
                      │ api:3000  (not published)
                 ┌────▼─────┐
                 │   api    │  Bun + Elysia + MCP
                 └────┬─────┘
                      │ db:5432
                 ┌────▼─────┐
                 │    db    │  Postgres 18
                 └──────────┘
```

## Getting it running

```bash
git checkout "$(git tag --list 'v*' --sort=-version:refname | head -1)"   # the latest release
cp .env.example .env          # then set POSTGRES_PASSWORD
docker compose up --build -d
curl -s localhost:8080/api/health          # {"ok":true,"db":true}
open http://localhost:8080                 # register, and you have a library
```

That is the whole install. Migrations and seeding run inside the API container before it binds, so a
container that is accepting traffic is one whose schema is current and whose library is present.
Both are idempotent, so this is also the upgrade path, to the latest release:

```bash
git fetch --tags
git checkout "$(git tag --list 'v*' --sort=-version:refname | head -1)"
docker compose pull db          # the latest Postgres 18 minor release
docker compose build --pull     # rebuild api + web on FRESH Bun and Caddy base images
docker compose up -d
```

Each line does something the others do not:

- `docker compose pull` alone does **nothing** for `api` and `web`: they are built from source
  (`build:` in `docker-compose.yml`, no published `image:`), so only the Postgres image would be
  pulled. Rebuilding is what delivers new code, migrations and library entries.
- `up --build` without `--pull` rebuilds on the base images already cached, so the floating tags
  (`oven/bun:1.4-alpine`, `caddy:2-alpine`) would never deliver their security patches. `build
  --pull` re-resolves them.
- A Postgres **minor** release is a restart; a **major** one (18 → 19) is a dump and restore, and
  is a deliberate change to the image tag, never something `pull` does on its own.

## Deploying on push

This is how the maintainer's own instance deploys, and it is optional: an instance upgraded by hand,
as above, runs exactly the same — at a release, where this runs every commit on `main`, ahead of
the last one. Follow it only if you want every push to `main` of your own fork to
reach your server, and change the repository name in the deploy job's condition: as shipped, it
runs only in `innocentiv/cedo` (below).

`scripts/deploy.sh` is the upgrade path above as one command, run on the server in its checkout. It
pulls the latest Postgres minor release, rebuilds `api` and `web` on fresh base images, and starts
them with `up --wait`, which returns only once every service is healthy. So a build or a migration
that fails fails the deploy. A failed build leaves the running containers untouched.

`.github/workflows/ci.yml` runs the gate, `bun run check`, on every push and pull request. Only on
`main`, and only once the gate has passed, does it deploy that exact commit. The runner just
connects. It SSHes in with a key that the server's `authorized_keys` pins to
`scripts/deploy-ssh.sh`:

```
command="/home/<user>/cedo/scripts/deploy-ssh.sh",restrict ssh-ed25519 AAAA… github-actions-deploy
```

Whatever the client asks, that script runs. All it accepts is `deploy <sha>`, for a commit on
`main`. It checks the commit out, and that commit's `deploy.sh` takes over. It deploys the exact
commit that passed, never "the latest `main`". Otherwise a passing push followed quickly by a
failing one would deploy the second on the first's green run. The checkout on the server is
therefore a detached `HEAD` at whatever is live.

The build runs on the server, which keeps its `.env` and volumes, so nothing secret leaves it. The
server pulls the repository with a read-only deploy key of its own. The workflow needs four
repository secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (the private half of the pinned
key) and `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan <host>`, so the runner refuses an impostor).

The deploy job also runs only in the maintainer's repository, `innocentiv/cedo`, so a fork with
Actions on does not attempt a deploy it has no secrets for. To deploy from your own fork, put its
name in the job's `if:` and add the four secrets there.

Behind a reverse proxy that already serves other sites, set `WEB_BIND=127.0.0.1` in `.env`, so the
app is reachable only through that proxy, and let the proxy terminate TLS. Send the whole host to
`127.0.0.1:${WEB_PORT}`. Allow request bodies of at least 16 MB, since uploads are 12 MB plus
multipart framing. Forward `Host` and `X-Forwarded-Proto`, and **set** `X-Forwarded-For` to the
client's address — in nginx, `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`.

Then set `CEDO_TRUSTED_PROXIES=private_ranges` in `.env`. The login limit counts failures per
client address (ADR-0031), and Caddy believes `X-Forwarded-For` only from the proxies that
variable names — none by default. Unset behind a proxy, every client arrives as the proxy and they
share one count: fifty failed logins from anyone lock everyone out for a quarter of an hour. But set it only
behind a proxy that **sets** the header as above: one that passes on whatever the client wrote would
let a client claim any address it likes. Behind a CDN, add its ranges to the variable. The
curator's `platform_status` shows where the last login attempt came from: a real client's address,
not the proxy's, is the sign it works.

## Releases

A release is a tag, `v0.x.y`, cut by the maintainer from `main` (ADR-0032):

```bash
bun run release 0.2.0          # sets VERSION and the iPhone app's version, commits, tags v0.2.0
git push origin main v0.2.0    # deploys main, as any push does — and builds the iPhone app
```

- **The number.** `0.x` while AltStore is the only way the iPhone app is installed: a minor when the
  contract changes, so an installed app could not read what the server says, a patch otherwise.
  `VERSION` lives in the contract (`packages/contract/src/instance.ts`), read by the API and the
  app alike, and only `bun run release` changes it.
- **The iPhone app.** The tag runs `.github/workflows/ios.yml` on macOS: an unsigned `.ipa`, the
  AltStore source that lists it, and the icon, attached to the tag's release
  (`apps/app/scripts/build-ipa.sh`, which a Mac runs just the same). It refuses a tag that is not
  `VERSION`. Run by hand from the Actions tab, it builds the same and publishes nothing.
- **Every instance built from the tag** sends `/altstore/source.json` to that release
  (`apps/app/Caddyfile`, with the line `apps/app/scripts/altstore-caddy.ts` writes when the image is
  built). Built from `0.0.0`, before any release, it offers nothing.

## Installing the app

The web app installs to a phone's home screen: no app store, and the same for every instance. It then
opens full screen with its own icon, and opens at once — and without a signal — from the app shell
its service worker keeps (`apps/app/src/pwa/`). Only the shell: training data is still read from
the server; a set logged without a signal is kept on the phone and sent when one returns (#9, see
`docs/08-frontend.md`, "Logging without a signal").

**It needs HTTPS.** Browsers run a service worker, and Android offers to install, only on a secure
origin — `https://`, or `localhost` on the machine itself. At `http://192.168.1.20:8080` the app
works in the browser, and iOS can still add it to the home screen, but it opens with nothing kept
and needs the network every time. Put the instance behind the HTTPS you already have: the reverse
proxy on your NAS, Tailscale Serve, or a tunnel. Caddy serves plain HTTP on port 80 inside the
compose network, and leaves TLS to that front door.

- **iPhone and iPad (Safari):** open the instance and tap **Share** — on iOS 26, behind the **⋯**
  button beside the address. Then **Add to Home Screen** (under **View More** if it is not listed),
  leave **Open as Web App** on, and tap **Add**. Other browsers on iOS put the same item in their
  share menu.
- **Android (Chrome):** open the instance and tap **Install** when it is offered. Otherwise use
  **⋮ → Add to Home screen**, and choose **Install** rather than **Create shortcut**: a shortcut is
  only a bookmark, and opens in the browser.
- **Desktop (Chrome, Edge):** the install icon at the end of the address bar.

Sign in once inside the installed app: on iOS it keeps its own storage, apart from Safari's.

An upgrade reaches the installed app one opening late. It opens at once from the shell it kept, and
fetches the new one in the background for the next time. That is the price of opening without
waiting for the network.

### The iPhone app

There is also a native iPhone app, installed with **AltStore Classic** (ADR-0032): free, signed with
your own Apple ID, and offered by your own instance. It is one app for every instance: its first
screen asks for your server as you open it in a browser — `cedo.example.com`, or
`192.168.1.20:8080` — and checks that it is cedo before keeping it. Change it from the sign-in
screen; Settings shows it, and this app's version beside the server's.

It suits you if you already sideload; strangers are better served by the web app above. AltStore
asks for a computer running AltServer (macOS or Windows) to install it and to refresh it every
seven days, Developer Mode on the phone, your Apple ID's password, typed into AltServer, and one of
three active app slots, AltStore itself taking another ([AltStore](https://faq.altstore.io)).

**Installing it.** With AltStore on the phone, open this link in Safari there, with your server in
it — an instance serves its source at `/altstore/source.json`, over HTTPS, which AltStore needs:

```
altstore-classic://source?url=https://cedo.example.com/altstore/source.json
```

SideStore takes the same source, as `sidestore://source?url=…`. Then install cedo from the source.
The source lists the app built from the same release as your instance, so the two are always one
version: upgrade the instance, and AltStore offers the matching app — an older one too, should you
go back a release. Until the phone next reaches AltServer, the app it has may be a version behind;
Settings says so.

- **HTTPS, except on your own network.** Plain `http://` is accepted only to an IP address, a
  `.local` name or `localhost`: anywhere else your password would cross the network unprotected.
  The one HTTPS name the web app needs serves the phone too.
- **A self-signed certificate** is trusted as iOS trusts any: install your certificate authority as
  a profile, then turn on full trust for it under Settings → General → About → Certificate Trust
  Settings. iOS asks that the certificate name the server in its Subject Alternative Name, allow
  server authentication, and last 825 days at most. The app adds no exception of its own.
- **On your home network** iOS asks once whether cedo may find devices there; allow it later under
  Settings → Privacy & Security → Local Network.
- **A different version** from the server is said in Settings, naming which to update, and never
  stops you: the server checks every request, so an older app cannot write what it does not accept.

## Why one origin

The browser talks only to Caddy. `/api/*` is proxied to the API container; everything else is the
static export. Three things follow, and all of them matter for software handed to strangers:

- **No CORS anywhere.** Not a dependency, not a config block, no preflight on any mutation.
- **No API URL is baked into the build.** The app calls the relative path `/api`, so the same image
  works on any host at any port. Nothing about your NAS is compiled into it.
- **One port to open.** The API is on the compose network only, and the database is published
  solely on the host's loopback interface (for local tooling), never on the network.

The native app has no such proxy. It asks for the server on its first screen and keeps it, so no
build is made for one instance (#78): see "Installing the app".

## The images

Both are built from the repository **root**, because each depends on `packages/contract` through the
Bun workspace: the two are one install.

Every workspace manifest is copied so the lockfile matches exactly and `--frozen-lockfile` holds,
but `bun install --filter` installs only the members that image runs. The API image does not carry
the frontend's Expo tree, which is hundreds of megabytes it has no use for.

| Image | Base | Size |
| --- | --- | --- |
| `cedo-api` | `oven/bun:1.4-alpine` | ~152 MB |
| `cedo-web` | `caddy:2-alpine` | ~63 MB |

One trap worth knowing: Bun workspaces put a `node_modules` symlink directory **inside each member**
as well as in the root store. Copying only `/app/node_modules` produced a container that started and
then failed every import with "Cannot find package 'elysia'".

## Configuration

`.env` is read by compose. `apps/api/src/env.ts` validates the result with Zod and **refuses to
boot** if anything is missing or malformed, so a misconfigured instance fails immediately with a
readable message rather than throwing something obscure on the first request.

| Variable | Notes |
| --- | --- |
| `POSTGRES_PASSWORD` | Required. Compose refuses to start without it. |
| `POSTGRES_USER`, `POSTGRES_DB` | Default to `cedo`. |
| `WEB_PORT` | Host port. Default 8080. |
| `POSTGRES_PORT`, `POSTGRES_BIND` | Where Postgres is published on the host: `127.0.0.1:55432` by default, so only the machine itself can reach it. The containers never use this mapping. Set `POSTGRES_BIND=0.0.0.0` only to reach the database from another machine, deliberately. |
| `CEDO_CURATOR_USERNAME` | Deprecated. A fresh instance's first account is its curator, and sign-up then closes; the curator reopens it from Settings (ADR-0029). Only for an instance set up before that: promoted to curator on every seed run; register the account first, then restart. |

`DATABASE_URL` is **composed inside `docker-compose.yml`**, not read from `.env`. The host inside the
network is always the service name, and a `DATABASE_URL` left pointing at `localhost` — the value a
developer needs — would otherwise silently break the deployment.

## Postgres settings that are not defaults

```
-c shared_preload_libraries=pg_stat_statements,auto_explain
-c random_page_cost=1.1
```

`pg_stat_statements` and `auto_explain` are what make a stranger's slow instance diagnosable with no
shell: `GET /api/admin/slow-queries` and the `db_slow_queries` MCP tool read them. Statements are
normalised by the extension, so no user data is exposed. See `docs/06-api.md`.

`random_page_cost` matters more than it looks. The default of 4 models a spinning disk; every machine
this realistically runs on has SSD or NVMe, and at the default the planner refuses the trigram index
on exercise search and scans instead — measured at 20k rows, 5.96 ms / 354 buffers against 0.077 ms /
17 buffers. See `docs/05-database.md`.

The data volume is mounted at `/var/lib/postgresql`, **not** `/var/lib/postgresql/data`. Postgres 18
keeps the cluster in a version subdirectory so `pg_upgrade --link` works across major versions; the
deeper mount point puts a filesystem boundary in the way and makes a future upgrade painful for
everyone self-hosting.

## Backup and restore

Two volumes hold everything: `pgdata` and `uploads`.

**Nightly, on the server.** `scripts/backup.sh` writes the database as a `pg_dump` and the uploads
as an archive, into one dated directory under `~/backups/cedo` (`BACKUP_DIR`). It keeps 14 days
(`BACKUP_KEEP_DAYS`). Each backup is then restored into a scratch database beside the live one, and
its row counts are compared with the live database's, table by table. A backup that has never been
restored is a hope. A failed check keeps the backup and fails the run, where the journal shows it.

A systemd **user** timer runs it at 03:30. It's a user unit, not a system one, because under SELinux
a system service may not run a script in a home directory:

```bash
loginctl enable-linger "$USER"                 # user timers run without anyone logged in
systemctl --user link ~/cedo/scripts/systemd/cedo-backup.service ~/cedo/scripts/systemd/cedo-backup.timer
systemctl --user enable --now cedo-backup.timer
systemctl --user start cedo-backup.service     # one now, to see it work
journalctl --user-unit cedo-backup             # every run, and why one failed
systemctl --user list-timers cedo-backup.timer # when the next one runs
```

Two things that each cost a failed first run:

- **Joining the `docker` group does not reach a user manager already running.** It keeps the groups
  it started with, so a backup it runs cannot reach Docker. It fails silently, straight after its
  first line. `grep Groups /proc/$(pgrep -u "$USER" -x systemd)/status` shows whether it has the
  group. If it doesn't, `sudo systemctl restart user@$(id -u).service` restarts it. Your own login
  sessions are not touched by that, and neither are system services that run outside it.
- **`journalctl --user-unit`, not `journalctl --user -u`.** On a host whose journal is kept in memory
  (no `/var/log/journal`, the default on some distributions), a user unit's lines go to the system
  journal. `--user -u` then says "No journal files were found", while `--user-unit` reads them
  wherever they are. Kept in memory, they are gone after a reboot. The backups themselves are files
  and stay.

These backups stay on the server. They guard against a bad migration or a mistake, not against
losing the server: copy `~/backups/cedo` elsewhere for that.

To restore one, use the commands below with its `cedo.dump` and `uploads.tar.gz`.

By hand, the same two steps:

```bash
# Backup
docker compose exec -T db pg_dump -U cedo -Fc cedo > cedo-$(date +%F).dump
docker run --rm -v cedo_uploads:/data -v "$PWD":/out alpine \
  tar czf /out/cedo-uploads-$(date +%F).tar.gz -C /data .

# Restore, into an empty instance
docker compose up -d db
docker compose exec -T db pg_restore -U cedo -d cedo --clean --if-exists < cedo-2026-08-24.dump
docker run --rm -v cedo_uploads:/data -v "$PWD":/in alpine \
  tar xzf /in/cedo-uploads-2026-08-24.tar.gz -C /data
docker compose up -d
```

A dump is enough on its own if no media has been uploaded — YouTube links live in the database.

## TrueNAS Scale

Add it as a **Custom App** from this `docker-compose.yml`, or run it from a dataset over SSH. Two
notes specific to that box:

- Point the two volumes at datasets you already snapshot, rather than anonymous docker volumes.
- The `POSTGRES_PORT` mapping in `docker-compose.yml` exists for local development and is bound to
  loopback (`POSTGRES_BIND=127.0.0.1`), so it is not reachable from the network as shipped. Leave
  `POSTGRES_BIND` alone; nothing outside the compose network needs the database.

## Checking a deployment

```bash
curl -s localhost:8080/api/health                       # {"ok":true,"db":true}
curl -s localhost:8080/api/openapi                      # the Scalar UI, generated from the contract
curl -sI localhost:8080/sw.js | grep -i content-type    # text/javascript — else the app never installs
curl -sI localhost:8080/manifest.webmanifest | grep -i content-type   # application/manifest+json
open http://localhost:8080                              # register, browse, build, log
```

MCP arrives on the same port. **Settings → Connect your AI** shows its address, creates a token, and
writes the configuration with both filled in (`docs/07-mcp.md`).

The check worth doing by hand, because it is the invariant everything else rests on: register a
second user and confirm they see the seeded library but **not** the first user's personal exercises,
and get `404` rather than `403` when they ask for one by id. Sign-up closed behind the first
account, which curates the instance: open it from Settings for the second, then close it again
(ADR-0029).
