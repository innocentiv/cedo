/**
 * Must ALWAYS satisfy the contract's `Slug` schema. It does not merely name the group: `Group.slug`
 * is validated on the way out, and `GroupMembership` appears in `GET /groups` AND `GET /auth/me` —
 * so one bad slug 422s those routes permanently for every member of that group.
 *
 * The two ways the naive version broke: slicing to a fixed length could cut on a hyphen and leave
 * a trailing or doubled separator, and a name with no ASCII alphanumerics at all ('💪',
 * 'Тренировки', '!!!') reduced to an empty base.
 */
const SLUG_BASE_LIMIT = 40

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .slice(0, SLUG_BASE_LIMIT)
    // Strip separators AFTER slicing — slicing is what creates a dangling one.
    .replaceAll(/^-+|-+$/gu, '')

  const suffix = crypto.randomUUID().slice(0, 8)
  return base === '' ? `group-${suffix}` : `${base}-${suffix}`
}
