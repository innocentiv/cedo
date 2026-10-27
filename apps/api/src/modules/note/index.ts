import { Elysia } from 'elysia'
import { z } from 'zod'
import { AthleteNote, AthleteNoteInput, Id } from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import * as NoteService from './service.ts'

const notes = z.array(AthleteNote)
const one = z.object({ noteId: Id })
const theirs = z.object({ id: Id })
const theirOne = z.object({ id: Id, noteId: Id })

/**
 * Athlete notes (#41): about you at `/notes`, and about an athlete you coach at
 * `/athletes/:id/notes` — the one thing a coach writes there. Someone who does not share their
 * training with you is a 404 on every route, as on the coach's reads.
 */
export const noteRoutes = new Elysia({ tags: ['notes'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get('/notes', ({ caller }) => NoteService.list(caller), {
    response: notes,
    detail: { summary: 'What is known about you, for planning your training — newest first' },
  })
  .post('/notes', ({ caller, body }) => NoteService.create(caller, undefined, body), {
    body: AthleteNoteInput,
    response: AthleteNote,
  })
  .patch(
    '/notes/:noteId',
    ({ caller, params, body }) => NoteService.update(caller, undefined, params.noteId, body),
    { params: one, body: AthleteNoteInput, response: AthleteNote },
  )
  .delete(
    '/notes/:noteId',
    async ({ caller, params }) => {
      await NoteService.remove(caller, undefined, params.noteId)
      return { ok: true }
    },
    { params: one },
  )
  .get('/athletes/:id/notes', ({ caller, params }) => NoteService.list(caller, params.id), {
    params: theirs,
    response: notes,
    detail: { summary: 'What is known about an athlete you coach — newest first' },
  })
  .post(
    '/athletes/:id/notes',
    ({ caller, params, body }) => NoteService.create(caller, params.id, body),
    { params: theirs, body: AthleteNoteInput, response: AthleteNote },
  )
  .patch(
    '/athletes/:id/notes/:noteId',
    ({ caller, params, body }) => NoteService.update(caller, params.id, params.noteId, body),
    { params: theirOne, body: AthleteNoteInput, response: AthleteNote },
  )
  .delete(
    '/athletes/:id/notes/:noteId',
    async ({ caller, params }) => {
      await NoteService.remove(caller, params.id, params.noteId)
      return { ok: true }
    },
    { params: theirOne },
  )
