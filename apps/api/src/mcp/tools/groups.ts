import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { Caller } from '../../plugins/auth.ts'
import * as GroupService from '../../modules/group/service.ts'
import { READ, text } from '../format.ts'
import { groupLine } from '../format-group.ts'

/**
 * The groups you belong to (#52), for the tools that take a group id: a search narrowed to one
 * (`scope: 'group'`), a copy made into one (`toGroupId`), a library audited (`groupId`).
 */
export function registerGroupTools(server: McpServer, caller: Caller): void {
  server.registerTool(
    'group_list',
    {
      title: 'List your groups',
      description:
        'Every group you belong to, one line each: its name as other lines name an owning ' +
        'group (mine, library, or the name), your role in it, and its id — for scope: group, ' +
        'toGroupId and library_audit. You can add to and copy into a group you are an editor of.',
      inputSchema: z.object({}),
      annotations: READ,
    },
    async () => text((await GroupService.list(caller)).map((g) => groupLine(g)).join('\n')),
  )
}
