import { z } from 'zod'
import { Id, PaginationQuery, Timestamp } from './primitives.ts'

/**
 * What every ownable — an exercise, a workout, whatever is added next — shares on the wire. Written
 * once so a list of either is filtered, paged and described the same way. See GLOSSARY.md.
 */

/** Which slice of the visible ownables a list shows. */
export const OWNABLE_SCOPES = ['all', 'mine', 'favourites', 'group'] as const
export const OwnableScope = z.enum(OWNABLE_SCOPES)
export type OwnableScope = z.output<typeof OwnableScope>

/** The fields of an ownable list query, before its rule. Extend it with an ownable's own filters. */
export const OwnableQueryFields = PaginationQuery.extend({
  scope: OwnableScope.default('all'),
  groupId: Id.optional(),
  q: z.string().trim().max(100).optional(),
})

/**
 * `scope: 'group'` requires `groupId`. Modelled as two fields rather than a `group:<uuid>` string,
 * because a stringly-typed union cannot be validated or shown to an AI as a JSON Schema.
 */
export const withGroupRule = <
  TSchema extends z.ZodType<{ scope: OwnableScope; groupId?: string | undefined }>,
>(
  schema: TSchema,
) =>
  schema.refine((v) => v.scope !== 'group' || v.groupId !== undefined, {
    path: ['groupId'],
    message: "groupId is required when scope is 'group'",
  })

/**
 * The scope and its group as a tool takes them (#52): the query's own two fields, said for a reader
 * of the schema — a model — so it knows a group's scope names one by `groupId`.
 */
export const ScopeFields = {
  scope: OwnableQueryFields.shape.scope.describe(
    "'mine' is your personal group only; 'group' is the one `groupId` names (group_list)",
  ),
  groupId: OwnableQueryFields.shape.groupId.describe("With scope 'group': which group"),
}

export const OwnableQuery = withGroupRule(OwnableQueryFields)
export type OwnableQuery = z.output<typeof OwnableQuery>

/** On every ownable response. `canEdit` and `isFavourite` are computed per caller. */
export const ownableFields = {
  ownerGroupId: Id,
  createdBy: Id,
  canEdit: z.boolean(),
  isFavourite: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
