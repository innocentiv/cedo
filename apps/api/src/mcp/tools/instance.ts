import type { McpServer } from '@modelcontextprotocol/server'
import { InstancePatch } from '@cedo/contract'
import * as InstanceService from '../../modules/instance/service.ts'
import type { Caller } from '../../plugins/auth.ts'
import { REPLACES, signUpLine, text } from '../format.ts'

/**
 * The instance itself (#71): the curator opens sign-up while testers register, and closes it again.
 * The same function as `PATCH /instance`, which refuses anyone else. See ADR-0029.
 */
export function registerInstanceTools(server: McpServer, caller: Caller): void {
  server.registerTool(
    'instance_sign_up_set',
    {
      title: 'Open or close sign-up',
      description:
        'Whether this instance takes new accounts. Open it while testers register, then close it ' +
        'again: while it is open, anyone who reaches the instance can create an account. Curator ' +
        'only.',
      inputSchema: InstancePatch,
      annotations: REPLACES,
    },
    async (patch) => text(signUpLine((await InstanceService.update(caller, patch)).signUp)),
  )
}
