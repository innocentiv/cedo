import { describe, expect, test } from 'bun:test'
import { Account, AthleteNote, Bodyweight, TrainingReview, WeighIn } from '@cedo/contract'
import { aboutLine, noteLines, profileLine, weighInLine, weighInLines } from './format-file.ts'

/**
 * What the tools of an athlete's file say — `note_list`, `weigh_in_list`, `athlete_profile_set`,
 * and the line `training_review` says of the person — as the model reads it: a contract value in,
 * the whole text out, with no wire and no database (docs/07-mcp.md, "Adding a tool"). That the
 * tools reach these formatters, and who may read whose file, is `mcp.test.ts`'s, through the wire.
 */

const SAM = '00000000-0000-4000-8000-000000000001'
const COACH = '00000000-0000-4000-8000-000000000002'

describe('athlete notes', () => {
  /** Mid-morning on the reader's own calendar, so the day reads the same wherever this runs. */
  const morning = (day: number) => new Date(2026, 9, day, 9).toISOString()

  const fromCoach = AthleteNote.parse({
    id: '00000000-0000-4000-8000-000000000003',
    text: 'Left shoulder hurts on overhead work.\nKeep presses light until it settles.',
    author: { id: COACH, displayName: 'Coach Kim' },
    writtenAt: morning(12),
    editedAt: null,
    canEdit: false,
    canDelete: true,
  })

  const fromSam = AthleteNote.parse({
    id: '00000000-0000-4000-8000-000000000004',
    text: 'Prefers mornings',
    author: { id: SAM, displayName: 'Sam Lee' },
    writtenAt: morning(12),
    editedAt: morning(14),
    canEdit: true,
    canDelete: true,
  })

  test('each under who wrote it, when, and its id, its words indented line by line', () => {
    expect(noteLines([fromCoach, fromSam], SAM)).toBe(
      [
        'Coach Kim · Mon 12 Oct · 00000000-0000-4000-8000-000000000003',
        '  Left shoulder hurts on overhead work.',
        '  Keep presses light until it settles.',
        '',
        'You · Mon 12 Oct · edited Wed 14 Oct · 00000000-0000-4000-8000-000000000004',
        '  Prefers mornings',
      ].join('\n'),
    )
  })

  test('the coach reading them is the one called you, and the athlete is named', () => {
    expect(noteLines([fromCoach, fromSam], COACH)).toBe(
      [
        'You · Mon 12 Oct · 00000000-0000-4000-8000-000000000003',
        '  Left shoulder hurts on overhead work.',
        '  Keep presses light until it settles.',
        '',
        'Sam Lee · Mon 12 Oct · edited Wed 14 Oct · 00000000-0000-4000-8000-000000000004',
        '  Prefers mornings',
      ].join('\n'),
    )
  })

  test('one whose author’s account is gone is a former coach’s', () => {
    const orphaned = AthleteNote.parse({ ...fromCoach, author: null })
    expect(noteLines([orphaned], SAM).split('\n')[0]).toBe(
      'A former coach · Mon 12 Oct · 00000000-0000-4000-8000-000000000003',
    )
  })

  test('none written yet is said, not an empty answer', () => {
    expect(noteLines([], SAM)).toBe('No notes yet.')
  })
})

describe('weigh-ins', () => {
  const weighIn = (n: number, day: string, weightG: number): WeighIn =>
    WeighIn.parse({
      id: `00000000-0000-4000-8000-00000000002${String(n)}`,
      day,
      weightG,
      author: { id: SAM, displayName: 'Sam Lee' },
      canDelete: true,
    })

  const latest = weighIn(1, '2026-10-30', 82_400)
  const period = [latest, weighIn(2, '2026-10-29', 82_800), weighIn(3, '2026-10-23', 83_500)]
  const before = weighIn(4, '2026-09-01', 84_000)

  test('one is its day, twice — as it is sent and as it is read — and the weight', () => {
    expect(weighInLine(latest, 'kg')).toBe('2026-10-30 (Fri 30 Oct): 82.4 kg')
  })

  test('someone who reads pounds is written to in pounds', () => {
    // 135 lb is kept as 61 235 g, and reads back as 135.
    expect(weighInLine(weighIn(5, '2026-10-30', 61_235), 'lb')).toBe(
      '2026-10-30 (Fri 30 Oct): 135 lb',
    )
  })

  test('a period’s are a line each, newest first, then the latest before them', () => {
    expect(weighInLines(Bodyweight.parse({ weighIns: period, before }), 4, 'kg')).toBe(
      [
        'Weigh-ins in the last 4 weeks, newest first:',
        '  2026-10-30 (Fri 30 Oct): 82.4 kg',
        '  2026-10-29 (Thu 29 Oct): 82.8 kg',
        '  2026-10-23 (Fri 23 Oct): 83.5 kg',
        'The latest before them: 2026-09-01 (Tue 1 Sep): 84 kg',
      ].join('\n'),
    )
  })

  test('with none before the period, nothing is said of one', () => {
    expect(weighInLines(Bodyweight.parse({ weighIns: period, before: null }), 8, 'kg')).toBe(
      [
        'Weigh-ins in the last 8 weeks, newest first:',
        '  2026-10-30 (Fri 30 Oct): 82.4 kg',
        '  2026-10-29 (Thu 29 Oct): 82.8 kg',
        '  2026-10-23 (Fri 23 Oct): 83.5 kg',
      ].join('\n'),
    )
  })

  test('none taken at all is said, not an empty answer', () => {
    expect(weighInLines(Bodyweight.parse({ weighIns: [], before: null }), 4, 'kg')).toBe(
      'No weigh-ins in the last 4 weeks.',
    )
  })

  test('a period of one week is one week', () => {
    expect(weighInLines(Bodyweight.parse({ weighIns: [], before: null }), 1, 'kg')).toBe(
      'No weigh-ins in the last 1 week.',
    )
    expect(weighInLines(Bodyweight.parse({ weighIns: [latest], before: null }), 1, 'kg')).toBe(
      ['Weigh-ins in the last 1 week, newest first:', '  2026-10-30 (Fri 30 Oct): 82.4 kg'].join(
        '\n',
      ),
    )
  })
})

describe('what a review says of the person', () => {
  const About = TrainingReview.pick({ bodyweight: true, age: true })
  const latest = { day: '2026-10-30', weightG: 82_400 }
  const from = { day: '2026-09-01', weightG: 84_000 }

  test('their bodyweight, its change over the period, and the age they turn this year', () => {
    expect(aboutLine(About.parse({ bodyweight: { latest, from }, age: 36 }), 'kg')).toBe(
      'Bodyweight 82.4 kg on Fri 30 Oct, −1.6 kg since Tue 1 Sep. Age 36 this year.',
    )
  })

  test('neither known is said, both of them', () => {
    expect(aboutLine(About.parse({ bodyweight: null, age: null }), 'kg')).toBe(
      'No weigh-ins yet. Age not given.',
    )
  })

  test('a single weigh-in is a bodyweight with no change, and their age may still be unsaid', () => {
    expect(aboutLine(About.parse({ bodyweight: { latest, from: null }, age: null }), 'kg')).toBe(
      'Bodyweight 82.4 kg on Fri 30 Oct. Age not given.',
    )
  })

  test('an age is said with no weigh-in to go with it', () => {
    expect(aboutLine(About.parse({ bodyweight: null, age: 36 }), 'kg')).toBe(
      'No weigh-ins yet. Age 36 this year.',
    )
  })
})

describe('the profile, as `athlete_profile_set` left it', () => {
  const NOW = new Date(2026, 5, 15)

  const account = (birthYear: number | null): Account =>
    Account.parse({
      id: SAM,
      username: 'sam',
      displayName: 'Sam Lee',
      createdAt: '2026-01-05T09:00:00.000Z',
      weightUnit: 'kg',
      birthYear,
    })

  test('a year of birth is said back with the age it makes this year', () => {
    expect(profileLine(account(1990), NOW)).toBe('Saved. Born 1990: 36 this year.')
  })

  test('none given is said', () => {
    expect(profileLine(account(null), NOW)).toBe('Saved. Year of birth not given.')
  })
})
