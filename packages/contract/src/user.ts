import { z } from 'zod'
import { Id, NonEmptyString, Timestamp, patchOf } from './primitives.ts'
import { WeightUnit } from './units.ts'

/**
 * Authentication is username + password, hashed with argon2id (`Bun.password`). There is no IAM.
 *
 * The seam for adding one later is deliberate: `users.auth_provider` and `users.external_id` exist
 * in the schema from day one, and credential verification sits behind an `AuthProvider` interface
 * in the API. Adding OIDC is a new implementation of that interface, not a schema redesign.
 */

export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9._-]+$/u, 'Letters, numbers, dot, underscore and hyphen only')
export type Username = z.output<typeof Username>

/**
 * Length is the only rule, per NIST SP 800-63B: composition requirements (a digit, a symbol...)
 * measurably reduce password quality by pushing users toward predictable substitutions.
 */
const Password = z.string().min(8, 'Must be at least 8 characters').max(256)

export const User = z.object({
  id: Id,
  username: z.string(),
  displayName: z.string(),
  createdAt: Timestamp,
})
export type User = z.output<typeof User>

/**
 * The signed-in person's own record: who they are, and how they read. Only ever their OWN — `User`
 * is what a fellow group member sees, and how someone reads weights is nobody else's business.
 */
export const Account = User.extend({
  /** How this person reads and types weights. Everything is stored in grams regardless. */
  weightUnit: WeightUnit,
  /** Null until they say it (#42). */
  birthYear: z.int().nullable(),
})
export type Account = z.output<typeof Account>

/**
 * A year of birth: from 1900 to ten years ago. Only the person sets it — in Settings, or through
 * `athlete_profile_set` — and a coach of theirs reads it as an age (#42).
 */
export const BirthYear = z
  .int()
  .min(1900, 'From 1900')
  .refine((year) => year <= new Date().getFullYear() - 10, 'At least ten years ago')

/** The age a year of birth makes this year, as of `now`: 36, for 1990 in 2026. */
export const ageThisYear = (birthYear: number, now: Date): number => now.getFullYear() - birthYear

/** `36 this year`: an age as it is said — exact to within the year, as a year of birth is. */
export const ageLine = (age: number): string => `${String(age)} this year`

/**
 * `PATCH /auth/me`, and the MCP's `athlete_profile_set` — what a person may change about
 * themselves. Each part optional: what is left out stays as it is.
 */
export const MeUpdate = z.strictObject(
  patchOf({
    weightUnit: WeightUnit.describe('How you read and type weights'),
    birthYear: BirthYear.nullable().describe(
      'The year you were born, e.g. 1990; null to forget it',
    ),
  }),
)
export type MeUpdate = z.output<typeof MeUpdate>

export const RegisterInput = z.strictObject({
  username: Username,
  password: Password,
  displayName: NonEmptyString.max(80),
})
export type RegisterInput = z.output<typeof RegisterInput>

export const LoginInput = z.strictObject({
  username: Username,
  password: z.string().min(1),
})
export type LoginInput = z.output<typeof LoginInput>

/** The bearer token is returned once, at sign-in, and stored by the client. See docs/06-api.md. */
export const AuthResult = z.object({
  user: User,
  token: z.string(),
  expiresAt: Timestamp,
})
export type AuthResult = z.output<typeof AuthResult>
