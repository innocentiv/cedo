# 0009 — Media as `kind` + JSONB payload, uploads content-addressed

**Status:** Accepted (2026-08-23)

## Context

Exercises need illustration. The original plan said "images", but that is not the common case: most
people reference a YouTube video demonstrating the movement. More kinds are expected later — an
uploaded clip, an animation, a 3D model.

## Decision

One `media` table: stable columns (`id`, `kind`, `title`, `thumbnail_key`, `created_by`,
`created_at`) plus a **JSONB `payload`** validated by a Zod discriminated union — `image` or
`video_link`. Adding `video_upload`, `gif` or `model_3d` later extends the union and needs **no
migration**, the same pattern as `progression`.

**Media are immutable.** An id always addresses the same bytes or the same link, so there is no
update endpoint, and attaching media to an exercise shares the row rather than copying it. That is
why duplicating an exercise copies its muscle rows but reuses its media.

### Links resolve without a network call

`parseMediaUrl` reads provider and id from the URL itself, and thumbnails and embed URLs are
derived. Creating a link therefore never depends on a third party being reachable, and needs no API
key. An unrecognised host is still stored as a usable link, just not embeddable.

### Uploads are content-addressed

The blob key **is** the sha256 of the bytes, sharded two levels (`ab/cd/abcd…`). Identical uploads
deduplicate across users with no bookkeeping, re-uploading is free, and directories never accumulate
hundreds of thousands of entries.

Bytes are served from `/media/:id/blob` and `/media/:id/thumb` with `immutable` caching, so a blob
key never reaches a client.

### `Bun.Image` instead of `sharp`

Built into the runtime — nothing to compile on a NAS, no native addon to break on an architecture
nobody tested.

**The declared content-type is ignored.** `metadata()` reports what the bytes actually are, so a
file claiming `image/png` is stored under its true type or rejected. It can never become a broken
image for every viewer.

## Consequences

- Media are **not** ownable and carry no ACL. An id is an opaque uuid, so any authenticated caller
  holding one may fetch it. _Attaching_ media to an exercise is what checks visibility; serving does
  not. Guessing a uuid is not a realistic attack, and making blobs ownable would mean a permissions
  join on every image request.
- Deleting media is not implemented. Blobs are shared by content, so a delete would need reference
  counting; nothing yet creates enough of them for that to matter.
- `metadata()` only reads the header, so a file with a valid header and corrupt pixels passes that
  check and fails at re-encode. Both paths are guarded, or such an upload would be a 500 rather
  than the 422 it is.
- Storage sits behind a `BlobStore` interface; S3 or MinIO is one additional file.
