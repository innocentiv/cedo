import { Elysia } from 'elysia'
import { z } from 'zod'
import { Id, Media, MediaCreateLink } from '@cedo/contract'
import { invalid } from '../../lib/error.ts'
import { MAX_UPLOAD_BYTES } from '../../lib/media.ts'
import { authPlugin } from '../../plugins/auth.ts'
import * as MediaService from './service.ts'

const params = z.object({ id: Id })

/**
 * Uploaded bytes are immutable and cacheable forever, because the key IS their digest. `public` is
 * honest here precisely because the blob routes are unauthenticated — on an authenticated response
 * it would invite a shared cache to serve the body to someone without the credential.
 */
const IMMUTABLE = 'public, max-age=31536000, immutable'

async function serve(id: string, variant: 'blob' | 'thumb'): Promise<Response> {
  const { bytes, contentType } = await MediaService.bytesFor(id, variant)
  return new Response(bytes, {
    headers: { 'content-type': contentType, 'cache-control': IMMUTABLE },
  })
}

/**
 * Serving blobs is DELIBERATELY unauthenticated: the media id is the capability, and it is an
 * unguessable uuid.
 *
 * An `<img src>` cannot send a bearer token, and `Media.url` is published for the UI to render
 * directly — behind the auth guard every uploaded image rendered broken, and the only workaround
 * (fetch each image and build an object URL) is exactly the derivation the contract forbids of a
 * screen. The guard also bought almost nothing: media carry no ACL, so any authenticated caller
 * could already fetch any id. See docs/adr/0009-media-model.md.
 */
export const mediaBlobRoutes = new Elysia({ prefix: '/media', tags: ['media'] })
  .get('/:id/blob', async ({ params: { id } }) => await serve(id, 'blob'), {
    params,
    detail: { summary: 'The full-size bytes. Unauthenticated: the id is the capability.' },
  })
  .get('/:id/thumb', async ({ params: { id } }) => await serve(id, 'thumb'), {
    params,
    detail: { summary: 'A generated webp thumbnail. Unauthenticated: the id is the capability.' },
  })

/** CREATING media requires a session. Only reading the bytes does not. */
export const mediaRoutes = new Elysia({ prefix: '/media', tags: ['media'] })
  .use(authPlugin)
  .guard({ auth: true })
  .post('/link', ({ caller, body }) => MediaService.createLink(caller, body), {
    body: MediaCreateLink,
    response: Media,
    detail: { summary: 'Reference a video hosted elsewhere. No upload, no network call.' },
  })
  .post(
    '/',
    async ({ caller, request }) => {
      /**
       * The deprecation on `formData` is Node-specific advice to reach for a busboy dependency.
       * Bun parses multipart natively, and adding a parser contradicts the dependency principle.
       * See docs/adr/0006-oxc-lint-and-format.md.
       *
       * NOTE: this handler must not destructure `body`. Elysia's `parse` stage consumes the body
       * when a handler references it, and the request would then already be drained here.
       */
      // oxlint-disable-next-line typescript/no-deprecated
      const form = await request.formData().catch((cause: unknown) => {
        // Distinguished from a missing field: a malformed boundary or a truncated upload is a
        // different problem, and one message for both tells the client nothing actionable.
        throw invalid(
          `The request body is not valid multipart/form-data: ${cause instanceof Error ? cause.message : 'unreadable'}`,
        )
      })

      const file = form.get('file')
      if (!(file instanceof File)) throw invalid("Expected a multipart form with a 'file' field")
      return await MediaService.upload(caller, file)
    },
    {
      // Multipart is described by hand: a File has no meaningful JSON Schema.
      detail: {
        summary: `Upload an image (multipart/form-data, field 'file', max ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)`,
      },
    },
  )
