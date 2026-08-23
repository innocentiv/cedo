import { Elysia } from 'elysia'
import { z } from 'zod'
import { Id, Media, MediaCreateLink } from '@cedo/contract'
import { invalid } from '../../lib/error.ts'
import { MAX_UPLOAD_BYTES } from '../../lib/media.ts'
import { authPlugin } from '../../plugins/auth.ts'
import * as MediaService from './service.ts'

const params = z.object({ id: Id })

/** Uploaded bytes are immutable and cacheable forever, because the key IS their digest. */
const IMMUTABLE = 'public, max-age=31536000, immutable'

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
      // The deprecation on `formData` is Node-specific advice to reach for a busboy dependency.
      // Bun implements multipart parsing natively, and adding a parser contradicts the project's
      // dependency principle. See docs/adr/0006-oxc-lint-and-format.md.
      // oxlint-disable-next-line typescript/no-deprecated
      const form = await request.formData().catch(() => null)
      const file = form?.get('file')
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
  .get('/:id/blob', async ({ params: { id } }) => await serve(id, 'blob'), { params })
  .get('/:id/thumb', async ({ params: { id } }) => await serve(id, 'thumb'), { params })

async function serve(id: string, variant: 'blob' | 'thumb'): Promise<Response> {
  const { bytes, contentType } = await MediaService.bytesFor(id, variant)
  return new Response(bytes, {
    headers: { 'content-type': contentType, 'cache-control': IMMUTABLE },
  })
}
