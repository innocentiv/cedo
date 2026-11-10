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
  .get(
    '/notes',
    {
      response: notes,
      detail: { summary: 'What is known about you, for planning your training — newest first' },
    },
    ({ caller }) => NoteService.list(own(caller)),
  )
  .post(
    '/notes',
    {
      body: AthleteNoteInput,
      response: AthleteNote,
    },
    ({ caller, body }) => NoteService.create(own(caller), body),
  )
  .patch(
    '/notes/:noteId',
    { params: one, body: AthleteNoteInput, response: AthleteNote },
    ({ caller, params, body }) => NoteService.update(own(caller), params.noteId, body),
  )
  .delete('/notes/:noteId', { params: one }, async ({ caller, params }) => {
    await NoteService.remove(own(caller), params.noteId)
    return { ok: true }
  })
  .get(
    '/athletes/:id/notes',
    {
      params: theirs,
      response: notes,
      detail: { summary: 'What is known about an athlete you coach — newest first' },
    },
    async ({ caller, params }) => await NoteService.list(await ownOrCoached(caller, params.id)),
  )
  .post(
    '/athletes/:id/notes',
    { params: theirs, body: AthleteNoteInput, response: AthleteNote },
    async ({ caller, params, body }) =>
      await NoteService.create(await ownOrCoached(caller, params.id), body),
  )
  .patch(
    '/athletes/:id/notes/:noteId',
    { params: theirOne, body: AthleteNoteInput, response: AthleteNote },
    async ({ caller, params, body }) =>
      await NoteService.update(await ownOrCoached(caller, params.id), params.noteId, body),
  )
  .delete('/athletes/:id/notes/:noteId', { params: theirOne }, async ({ caller, params }) => {
    await NoteService.remove(await ownOrCoached(caller, params.id), params.noteId)
    return { ok: true }
  })
