import { describe, expect, test } from 'bun:test'
import { AthleteEquipment, Exercise, Media, lbToG, page } from '@cedo/contract'
import type { LibraryAudit } from '../modules/review/curation.ts'
import type { GroupNameOf } from './format-group.ts'
import {
  auditSummary,
  equipmentLines,
  exerciseDetail,
  exerciseLines,
  mediaCreated,
  muscleLines,
} from './format-library.ts'

/**
 * What the library's tools say, as the model reads it: the muscles, a search's lines, one exercise
 * whole, a link registered, the audit, and what someone has to train with — a contract value in,
 * the whole text out, with no wire and no database (docs/07-mcp.md, "Adding a tool"). That the
 * tools reach these is `mcp.test.ts`'s, through the wire.
 */

const PERSONAL = '00000000-0000-4000-8000-000000000001'
const LIBRARY = '00000000-0000-4000-8000-000000000002'
const SQUAD = '00000000-0000-4000-8000-000000000003'
const CURATOR = '00000000-0000-4000-8000-000000000011'
const SQUAT = '00000000-0000-4000-8000-000000000021'
const STEP_UP = '00000000-0000-4000-8000-000000000022'
const SPLIT_SQUAT = '00000000-0000-4000-8000-000000000023'
const PUSH_UP = '00000000-0000-4000-8000-000000000024'
const VIDEO = '00000000-0000-4000-8000-000000000031'
const PHOTO = '00000000-0000-4000-8000-000000000032'

/** The caller's groups by name, as `groupNames` hands them to a line (`format-group.test.ts`). */
const NAMES = new Map([
  [PERSONAL, 'mine'],
  [LIBRARY, 'library'],
  [SQUAD, 'Squad'],
])
const nameOf: GroupNameOf = (groupId) => NAMES.get(groupId) ?? 'another group'

/**
 * The library's squat, as a reader of the library with a barbell and a rack sees it. Its muscles
 * are stored out of order, as nothing sorts them before a line does.
 */
const exercise = (fields: Partial<Exercise> = {}): Exercise =>
  Exercise.parse({
    id: SQUAT,
    name: 'Barbell Back Squat',
    tracking: 'weight_reps',
    description: '',
    instructions: '',
    equipment: ['barbell', 'rack'],
    isUnilateral: false,
    muscles: [
      { muscle: 'gluteus_maximus', loadPct: 30 },
      { muscle: 'erector_spinae', loadPct: 10 },
      { muscle: 'quadriceps', loadPct: 45 },
      { muscle: 'hamstrings', loadPct: 15 },
    ],
    mediaIds: [],
    media: [],
    doable: true,
    ownerGroupId: LIBRARY,
    createdBy: CURATOR,
    canEdit: false,
    isFavourite: false,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
    ...fields,
  })

/** The caller's own step-up: nothing to flag but its owning group, and nothing said of it yet. */
const mine = (fields: Partial<Exercise> = {}): Exercise =>
  exercise({
    id: STEP_UP,
    name: 'Step-Up',
    equipment: null,
    muscles: [{ muscle: 'quadriceps', loadPct: 100 }],
    ownerGroupId: PERSONAL,
    canEdit: true,
    ...fields,
  })

const found = (items: Exercise[], nextCursor: string | null = null) =>
  page(Exercise).parse({ items, nextCursor })

const video = Media.parse({
  id: VIDEO,
  kind: 'video_link',
  title: 'How to squat',
  url: 'https://www.youtube.com/watch?v=abcdefghijk',
  thumbnailUrl: 'https://img.youtube.com/vi/abcdefghijk/hqdefault.jpg',
  embedUrl: 'https://www.youtube.com/embed/abcdefghijk',
  width: null,
  height: null,
  createdAt: '2026-09-01T08:00:00.000Z',
})

describe('the muscles', () => {
  const lines = muscleLines().split('\n')

  test('each by the slug the tools take, with its region and its name', () => {
    expect(lines[0]).toBe('deltoid_anterior (upper) — Front delt')
    expect(lines.find((line) => line.startsWith('quadriceps '))).toBe('quadriceps (lower) — Quads')
  })

  test('then how many there are, and the rule of their loads', () => {
    expect(lines.slice(-2)).toEqual([
      '',
      '34 muscles. Loads on one exercise must sum to exactly 100.',
    ])
    expect(lines).toHaveLength(36)
  })
})

describe('a search’s exercises', () => {
  test('none matched is said, not an empty answer', () => {
    expect(exerciseLines(found([]), nameOf)).toBe('No exercises matched.')
  })

  test('a line each: name, what it needs, its muscles by load, its flags, and its id', () => {
    const lines = exerciseLines(
      found([
        exercise(),
        mine({
          id: PUSH_UP,
          name: 'Push-Up',
          tracking: 'bodyweight_reps',
          equipment: [],
          muscles: [
            { muscle: 'triceps_brachii', loadPct: 25 },
            { muscle: 'pectoralis_major', loadPct: 60 },
            { muscle: 'deltoid_anterior', loadPct: 15 },
          ],
        }),
        mine({
          id: SPLIT_SQUAT,
          name: 'Split Squat',
          isUnilateral: true,
          muscles: [
            { muscle: 'quadriceps', loadPct: 60 },
            { muscle: 'gluteus_maximus', loadPct: 40 },
          ],
          ownerGroupId: SQUAD,
        }),
      ]),
      nameOf,
    )
    expect(lines).toBe(
      [
        `Barbell Back Squat | barbell + rack | quadriceps 45%, gluteus_maximus 30%, hamstrings 15%, erector_spinae 10% | [library, read-only] | ${SQUAT}`,
        `Push-Up | no equipment | pectoralis_major 60%, triceps_brachii 25%, deltoid_anterior 15% | [mine, bodyweight_reps] | ${PUSH_UP}`,
        `Split Squat | equipment not described | quadriceps 60%, gluteus_maximus 40% | [Squad, unilateral] | ${SPLIT_SQUAT}`,
      ].join('\n'),
    )
  })

  test('the caller’s own lift, doable, is flagged with its owning group alone', () => {
    expect(exerciseLines(found([mine()]), nameOf)).toBe(
      `Step-Up | equipment not described | quadriceps 100% | [mine] | ${STEP_UP}`,
    )
  })

  /** #35: shown only when asked for all of them, and then marked. */
  test('one the reader lacks the equipment for is flagged as missing it', () => {
    const gym = mine({ name: 'Gym Back Squat', equipment: ['barbell', 'rack'], doable: false })
    expect(exerciseLines(found([gym]), nameOf)).toBe(
      `Gym Back Squat | barbell + rack | quadriceps 100% | [mine, Missing equipment] | ${STEP_UP}`,
    )
  })

  /** #47: the owning group leads, so a copy never reads like what it was copied from. */
  test('every flag at once: owning group, read-only, tracking, unilateral, missing equipment', () => {
    const hold = exercise({
      name: 'Side Plank',
      tracking: 'duration',
      equipment: ['flat_bench'],
      isUnilateral: true,
      muscles: [{ muscle: 'obliques', loadPct: 100 }],
      doable: false,
      ownerGroupId: SQUAD,
    })
    expect(exerciseLines(found([hold]), nameOf)).toBe(
      `Side Plank | flat_bench | obliques 100% | [Squad, read-only, duration, unilateral, Missing equipment] | ${SQUAT}`,
    )
  })

  test('more than the page holds: said after the lines, with what to do about it', () => {
    expect(exerciseLines(found([mine()], 'next-page'), nameOf)).toBe(
      [
        `Step-Up | equipment not described | quadriceps 100% | [mine] | ${STEP_UP}`,
        '',
        '(more results exist; narrow the search)',
      ].join('\n'),
    )
  })
})

describe('one exercise, whole', () => {
  test('every part a line: tracking, needs, muscles, its words, its media, who owns it', () => {
    const photo = Media.parse({
      id: PHOTO,
      kind: 'image',
      title: 'At the bottom',
      url: `/media/${PHOTO}/blob`,
      thumbnailUrl: `/media/${PHOTO}/blob`,
      embedUrl: null,
      width: 1200,
      height: 800,
      createdAt: '2026-09-01T08:00:00.000Z',
    })
    const whole = exercise({
      description: 'A squat with the bar across the upper back.',
      instructions: 'Brace, sit back and down, then stand.',
      mediaIds: [VIDEO, PHOTO],
      media: [video, photo],
    })
    expect(exerciseDetail(whole, nameOf)).toBe(
      [
        `Barbell Back Squat  (${SQUAT})`,
        'tracking: weight_reps',
        'needs: barbell + rack',
        'muscles: quadriceps 45%, gluteus_maximus 30%, hamstrings 15%, erector_spinae 10%',
        'description: A squat with the bar across the upper back.',
        'instructions: Brace, sit back and down, then stand.',
        'media:',
        '  - video_link: https://www.youtube.com/watch?v=abcdefghijk',
        `  - image: /media/${PHOTO}/blob`,
        'owning group: library',
        'editable: no',
      ].join('\n'),
    )
  })

  test('with no description, instructions or media, and the caller’s to edit', () => {
    expect(exerciseDetail(mine(), nameOf)).toBe(
      [
        `Step-Up  (${STEP_UP})`,
        'tracking: weight_reps',
        'needs: equipment not described',
        'muscles: quadriceps 100%',
        'media: none',
        'owning group: mine',
        'editable: yes',
      ].join('\n'),
    )
  })

  /** #33: needing nothing is a claim, apart from nobody having said. */
  test('what it needs is said three ways: not described, nothing, or each item', () => {
    const needs = (equipment: Exercise['equipment']) =>
      exerciseDetail(mine({ equipment }), nameOf).split('\n')[2]
    expect(needs(null)).toBe('needs: equipment not described')
    expect(needs([])).toBe('needs: no equipment')
    expect(needs(['dumbbells', 'flat_bench'])).toBe('needs: dumbbells + flat_bench')
  })

  test('one done a side at a time says so beside its tracking', () => {
    const lines = exerciseDetail(mine({ isUnilateral: true }), nameOf).split('\n')
    expect(lines[1]).toBe('tracking: weight_reps, unilateral')
  })

  test('one the reader lacks the equipment for says so beside what it needs', () => {
    const gym = mine({ equipment: ['barbell', 'rack'], doable: false })
    expect(exerciseDetail(gym, nameOf).split('\n')[2]).toBe(
      'needs: barbell + rack [Missing equipment]',
    )
  })
})

describe('a link registered', () => {
  test('one that plays in place: its id, its kind, and the player’s address', () => {
    expect(mediaCreated(video)).toBe(
      `Created media ${VIDEO} (video_link). Embeddable: https://www.youtube.com/embed/abcdefghijk.`,
    )
  })

  test('one that does not says no', () => {
    const plain = { ...video, url: 'https://example.com/squat', thumbnailUrl: null, embedUrl: null }
    expect(mediaCreated(plain)).toBe(`Created media ${VIDEO} (video_link). Embeddable: no.`)
  })
})

describe('the library’s audit', () => {
  const audit = (fields: Partial<LibraryAudit> = {}): LibraryAudit => ({
    groupId: LIBRARY,
    total: 12,
    scannedForDuplicates: 12,
    possibleDuplicates: [],
    thinCoverage: [],
    missingInstructions: [],
    missingMedia: [],
    undescribedEquipment: [],
    singleMuscle: [],
    ...fields,
  })

  /**
   * The summary's blocks: its head, then a section each, a blank line or more apart. How many
   * blank lines is left unsaid: the head is followed by three today, which reads as an accident.
   */
  const blocks = (summary: string) => summary.split(/\n{2,}/u)

  test('nothing to look at: every section is there, and says none', () => {
    expect(blocks(auditSummary(audit()))).toEqual([
      '12 exercises in this library.',
      'Possible duplicates: none',
      'Thin muscle coverage: none',
      'Missing instructions: none',
      'Missing media: none',
      'Equipment not described: none',
      'Attributed to a single muscle (check these are really isolation lifts): none',
    ])
  })

  test('every section filled: its count, then a line each', () => {
    const filled = audit({
      total: 40,
      scannedForDuplicates: 40,
      possibleDuplicates: [
        { a: 'Barbell Back Squat', b: 'Back Squat', similarity: 0.71 },
        { a: 'Push-Up', b: 'Push Up', similarity: 0.8 },
      ],
      thinCoverage: [
        { muscle: 'soleus', exercises: 0 },
        { muscle: 'tibialis_anterior', exercises: 1 },
      ],
      missingInstructions: ['Step-Up'],
      missingMedia: ['Step-Up', 'Sissy Squat'],
      undescribedEquipment: ['Mystery Lift'],
      singleMuscle: ['Leg Extension', 'Biceps Curl'],
    })
    expect(blocks(auditSummary(filled))).toEqual([
      '40 exercises in this library.',
      [
        'Possible duplicates (2):',
        '  "Barbell Back Squat" ~ "Back Squat"  (similarity 0.71)',
        '  "Push-Up" ~ "Push Up"  (similarity 0.8)',
      ].join('\n'),
      [
        'Thin muscle coverage (2):',
        '  soleus: 0 exercise(s)',
        '  tibialis_anterior: 1 exercise(s)',
      ].join('\n'),
      ['Missing instructions (1):', '  Step-Up'].join('\n'),
      ['Missing media (2):', '  Step-Up', '  Sissy Squat'].join('\n'),
      ['Equipment not described (1):', '  Mystery Lift'].join('\n'),
      [
        'Attributed to a single muscle (check these are really isolation lifts) (2):',
        '  Leg Extension',
        '  Biceps Curl',
      ].join('\n'),
    ])
  })

  test('a duplicate scan that did not reach every exercise says how far it got', () => {
    const capped = audit({ total: 2400, scannedForDuplicates: 2000 })
    expect(blocks(auditSummary(capped))[0]).toBe(
      '2400 exercises in this library. The duplicate scan compared the first 2000 by name.',
    )
  })
})

/** #34: by the slugs `equipment_set` takes, so what is read can be said back. */
describe('what someone has to train with', () => {
  test('not described yet is told apart from nothing: every exercise is doable', () => {
    const unsaid = AthleteEquipment.parse({ described: false, items: [] })
    expect(equipmentLines(unsaid, 'kg')).toBe('Not described yet: every exercise counts as doable.')
  })

  test('described as nothing at all', () => {
    const nothing = AthleteEquipment.parse({ described: true, items: [] })
    expect(equipmentLines(nothing, 'kg')).toBe('No equipment at all.')
  })

  test('an item a line, one that holds the load with how its weights go', () => {
    const gym = AthleteEquipment.parse({
      described: true,
      items: [
        { slug: 'kettlebells', weights: null },
        { slug: 'barbell', weights: { stepG: 2500, minG: 20_000, maxG: null } },
        { slug: 'dumbbells', weights: { stepG: 2000, minG: 2000, maxG: 30_000 } },
        { slug: 'rack', weights: null },
      ],
    })
    expect(equipmentLines(gym, 'kg')).toBe(
      [
        'kettlebells: weights not known',
        'barbell: from 20 kg up, by 2.5 kg',
        'dumbbells: from 2 kg to 30 kg, by 2 kg',
        'rack',
      ].join('\n'),
    )
  })

  test('the weights read in the reader’s unit', () => {
    const pounds = AthleteEquipment.parse({
      described: true,
      items: [{ slug: 'barbell', weights: { stepG: lbToG(5), minG: lbToG(45), maxG: null } }],
    })
    expect(equipmentLines(pounds, 'lb')).toBe('barbell: from 45 lb up, by 5 lb')
  })
})
