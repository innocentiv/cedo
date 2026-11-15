import * as GroupService from '../../modules/group/service.ts'
import type { Caller } from '../../plugins/auth.ts'
import { type GroupNameOf, groupNames } from '../format-group.ts'

/**
 * The groups the caller belongs to, read for the lines that name an owning group (#47). The one
 * read a formatter's words need: here, with the tools, so no `format*.ts` loads the database.
 */
export const groupNamesOf = async (caller: Caller): Promise<GroupNameOf> =>
  groupNames(await GroupService.list(caller))
