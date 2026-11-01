import { Elysia } from 'elysia'
import { z } from 'zod'
import { AthleteNote, AthleteNoteInput, Id } from '@cedo/contract'
import { authPlugin } from '../../plugins/auth.ts'
import { own, ownOrCoached } from '../coaching/training.ts'
import * as NoteService from './service.ts'

const notes = z.array(AthleteNote)
const one = z.object({ noteId: Id })
const theirs = z.object({ id: Id })
const theirOne = z.object({ id: Id, noteId: Id })

/**
 * Athlete notes (#41): about you at `/notes`, and about an athlete you coach at
 * `/athletes/:id/notes` — whose they are resolved here (`own`, `ownOrCoached`), once. Someone who
 * does not share their training with you is a 404 on every route, as on the coach's reads.
 */
export const noteRoutes = new Elysia({ tags: ['notes'] })
  .use(authPlugin)
  .guard({ auth: true })
  .get('/notes', ({ caller }) => NoteService.list(own(caller)), {
    response: notes,
    detail: { summary: 'What is known about you, for planning your training — newest first' },
  })
  .post('/notes', ({ caller, body }) => NoteService.create(own(caller), body), {
    body: AthleteNoteInput,
    response: AthleteNote,
  })
  .patch(
    '/notes/:noteId',
    ({ caller, params, body }) => NoteService.update(own(caller), params.noteId, body),
    { params: one, body: AthleteNoteInput, response: AthleteNote },
  )
  .delete(
    '/notes/:noteId',
    async ({ caller, params }) => {
      await NoteService.remove(own(caller), params.noteId)
      return { ok: true }
    },
    { params: one },
  )
  .get(
    '/athletes/:id/notes',
    async ({ caller, params }) => await NoteService.list(await ownOrCoached(caller, params.id)),
    {
      params: theirs,
      response: notes,
      detail: { summary: 'What is known about an athlete you coach — newest first' },
    },
  )
  .post(
    '/athletes/:id/notes',
    async ({ caller, params, body }) =>
      await NoteService.create(await ownOrCoached(caller, params.id), body),
    { params: theirs, body: AthleteNoteInput, response: AthleteNote },
  )
  .patch(
    '/athletes/:id/notes/:noteId',
    async ({ caller, params, body }) =>
      await NoteService.update(await ownOrCoached(caller, params.id), params.noteId, body),
    { params: theirOne, body: AthleteNoteInput, response: AthleteNote },
  )
  .delete(
    '/athletes/:id/notes/:noteId',
    async ({ caller, params }) => {
      await NoteService.remove(await ownOrCoached(caller, params.id), params.noteId)
      return { ok: true }
    },
    { params: theirOne },
  )
