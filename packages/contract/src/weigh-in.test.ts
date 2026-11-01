import { describe, expect, test } from 'bun:test'
import { BirthYear, MeUpdate, ageLine, ageThisYear } from './user.ts'
import {
  type Bodyweight,
  type WeighIn,
  WeighInInput,
  formatCalendarDay,
  formatWeightChange,
  trendLine,
  bodyweightTrend,
  calendarDayOf,
  trendParts,
  utcDayWeeksBefore,
  weighInRow,
} from './weigh-in.ts'

const at = (n: number, day: string, weightG: number): WeighIn => ({
  id: `00000000-0000-4000-8000-00000000000${String(n)}`,
  day,
  weightG,
  author: null,
  canDelete: true,
})

const isoDay = (offsetDays: number): string =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

describe('a weigh-in', () => {
  test('is a day and a weight in grams, from 20 kg to 400 kg, and nothing else', () => {
    expect(WeighInInput.parse({ day: '2026-10-30', weightG: 82_400 })).toEqual({
      day: '2026-10-30',
      weightG: 82_400,
    })
    for (const weightG of [19_999, 400_001, 82.5]) {
      expect(WeighInInput.safeParse({ day: '2026-10-30', weightG }).success).toBe(false)
    }
    for (const day of ['2026-02-30', '30/10/2026', '2026-10-30T07:00:00Z']) {
      expect(WeighInInput.safeParse({ day, weightG: 82_400 }).success).toBe(false)
    }
    expect(WeighInInput.safeParse({ day: '2026-10-30', weightG: 82_400, x: 1 }).success).toBe(false)
  })

  test('is taken on a day already begun somewhere: tomorrow in UTC at the latest', () => {
    expect(WeighInInput.safeParse({ day: isoDay(1), weightG: 82_400 }).success).toBe(true)
    expect(WeighInInput.safeParse({ day: isoDay(2), weightG: 82_400 }).success).toBe(false)
  })
})

describe("a period's bodyweight", () => {
  const before = at(1, '2026-09-01', 84_000)
  const first = at(2, '2026-09-10', 83_500)
  const latest = at(3, '2026-10-30', 82_400)
  const of = (weighIns: WeighIn[], b: WeighIn | null): Bodyweight => ({ weighIns, before: b })

  test('changes from the latest weigh-in before the period, when there is one', () => {
    expect(bodyweightTrend(of([latest, first], before))).toEqual({
      latest: { day: '2026-10-30', weightG: 82_400 },
      from: { day: '2026-09-01', weightG: 84_000 },
    })
  })

  test("changes from the period's first weigh-in when none came before it", () => {
    expect(bodyweightTrend(of([latest, first], null))?.from).toEqual({
      day: '2026-09-10',
      weightG: 83_500,
    })
  })

  test('is a weight with no change when it is the only one', () => {
    expect(bodyweightTrend(of([latest], null))).toEqual({
      latest: { day: '2026-10-30', weightG: 82_400 },
      from: null,
    })
  })

  test('is the last one known, with no change, when none was taken in the period', () => {
    expect(bodyweightTrend(of([], before))).toEqual({
      latest: { day: '2026-09-01', weightG: 84_000 },
      from: null,
    })
  })

  test('is nothing with no weigh-in at all', () => {
    expect(bodyweightTrend(of([], null))).toBeNull()
  })

  test('is said in the reader’s unit, signed', () => {
    const trend = bodyweightTrend(of([latest, first], before))
    if (trend === null) throw new Error('no trend')
    expect(trendLine(trend, 'kg')).toBe('82.4 kg on Fri 30 Oct, −1.6 kg since Tue 1 Sep')
    expect(formatWeightChange(400, 'kg')).toBe('+0.4 kg')
    expect(formatWeightChange(0, 'lb')).toBe('no change')
  })

  test('is set out in parts for a screen: the weight, its day, and its change', () => {
    const trend = bodyweightTrend(of([latest, first], before))
    if (trend === null) throw new Error('no trend')
    expect(trendParts(trend, 'kg')).toEqual({
      weight: '82.4 kg',
      on: 'Fri 30 Oct',
      change: '−1.6 kg since Tue 1 Sep',
    })
    expect(trendParts({ ...trend, from: null }, 'kg').change).toBeNull()
  })

  test('begins a period on the server’s day, the weeks before', () => {
    const late = Date.UTC(2026, 10, 1, 23, 30)
    expect(utcDayWeeksBefore(late, 1)).toBe('2026-10-25')
    expect(utcDayWeeksBefore(late, 8)).toBe('2026-09-06')
  })

  test('takes today from the device’s own calendar, not UTC’s', () => {
    expect(calendarDayOf(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(calendarDayOf(new Date(2026, 10, 1, 0, 1))).toBe('2026-11-01')
  })

  test('names who took it only when they are neither the reader nor whom it is of', () => {
    const sam = '00000000-0000-4000-8000-0000000000a1'
    const dana = '00000000-0000-4000-8000-0000000000a2'
    const by = (id: string, displayName: string) => ({ ...latest, author: { id, displayName } })
    const onSams = { readerId: sam, athleteId: sam }
    const onDanas = { readerId: dana, athleteId: sam }
    expect(weighInRow(by(dana, 'Dana'), 'kg', onSams)).toBe('Fri 30 Oct · 82.4 kg · Dana')
    expect(weighInRow(by(sam, 'Sam'), 'kg', onSams)).toBe('Fri 30 Oct · 82.4 kg')
    expect(weighInRow(by(sam, 'Sam'), 'kg', onDanas)).toBe('Fri 30 Oct · 82.4 kg')
    expect(weighInRow(by(dana, 'Dana'), 'kg', onDanas)).toBe('Fri 30 Oct · 82.4 kg')
    expect(weighInRow(latest, 'lb', onSams)).toBe('Fri 30 Oct · 181.66 lb')
  })

  test('says a calendar day as that day, whatever the clock’s zone', () => {
    expect(formatCalendarDay('2026-11-01')).toBe('Sun 1 Nov')
  })
})

describe('a year of birth', () => {
  const thisYear = new Date().getFullYear()

  test('is from 1900 to ten years ago', () => {
    expect(BirthYear.safeParse(1900).success).toBe(true)
    expect(BirthYear.safeParse(thisYear - 10).success).toBe(true)
    for (const year of [1899, thisYear - 9, 1990.5]) {
      expect(BirthYear.safeParse(year).success).toBe(false)
    }
  })

  test('is changed alone, forgotten with null, and left as it is when not said', () => {
    expect(MeUpdate.parse({ birthYear: 1990 })).toEqual({ birthYear: 1990 })
    expect(MeUpdate.parse({ birthYear: null })).toEqual({ birthYear: null })
    expect(MeUpdate.parse({ weightUnit: 'lb' })).toEqual({ weightUnit: 'lb' })
  })

  test('is read as the age it makes this year', () => {
    expect(ageThisYear(1990, new Date(2026, 0, 1))).toBe(36)
    expect(ageThisYear(1990, new Date(2026, 11, 31))).toBe(36)
    expect(ageLine(36)).toBe('36 this year')
  })
})
