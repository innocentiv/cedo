import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { GROUP_KINDS, GROUP_ROLES, WEIGHT_UNITS } from '@cedo/contract'

/** The contract's own list, so a unit added there is a migration here. */
export const weightUnit = pgEnum('weight_unit', WEIGHT_UNITS)

export const groupKind = pgEnum('group_kind', GROUP_KINDS)
export const groupRole = pgEnum('group_role', GROUP_ROLES)

/**
 * `auth_provider` and `external_id` exist from day one so adding OIDC later is a new
 * `AuthProvider` implementation rather than a schema redesign. See docs/03-domain-model.md.
 */
export const authProvider = pgEnum('auth_provider', ['local'])

export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    kind: groupKind('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('groups_slug_idx').on(t.slug)],
)

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Always lowercased before it gets here — the contract's `Username` schema does it — so a
     * plain unique index is case-insensitive in effect, and no citext extension is needed.
     */
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    /** How this person reads and types weights. Display only: every weight is stored in grams. */
    weightUnit: weightUnit('weight_unit').notNull().default('kg'),
    authProvider: authProvider('auth_provider').notNull().default('local'),
    externalId: text('external_id'),
    /**
     * When they last said what they train with (#34) — null until they have, when nothing is
     * filtered for them: no equipment rows is nothing at all only once this is set.
     */
    equipmentDescribedAt: timestamp('equipment_described_at', { withTimezone: true }),
    /**
     * Created with the user, in the same transaction. Not null: a user without a personal group
     * could not own anything, so there is no valid state where this is absent.
     */
    personalGroupId: uuid('personal_group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_username_idx').on(t.username),
    uniqueIndex('users_external_idx')
      .on(t.authProvider, t.externalId)
      .where(sql`${t.externalId} is not null`),
  ],
)

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: groupRole('role').notNull(),
    /**
     * The member lets the group's editors read their training (#11). On the membership, so leaving
     * or being removed withdraws it with the row. See docs/adr/0021-coaching-through-groups.md.
     */
    sharesTraining: boolean('shares_training').notNull().default(false),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A real composite primary key, which also serves as the (group_id, user_id) lookup index.
    primaryKey({ columns: [t.groupId, t.userId] }),
    /** Hit on EVERY authenticated request to build the caller's group list. */
    index('group_members_user_idx').on(t.userId),
  ],
)

/**
 * Opaque bearer tokens, stored only as sha256 so a database leak yields no usable credential and
 * a token can be revoked. That revocability is the reason for opaque tokens over JWTs.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** The single hottest lookup in the system: every authenticated request starts here. */
    uniqueIndex('sessions_token_hash_idx').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
)

/** Long-lived tokens for MCP clients, so an AI acts as a real user. See docs/07-mcp.md. */
export const personalAccessTokens = pgTable(
  'personal_access_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('pats_token_hash_idx').on(t.tokenHash), index('pats_user_idx').on(t.userId)],
)
