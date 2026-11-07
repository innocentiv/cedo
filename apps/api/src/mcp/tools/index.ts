import type { McpServer } from '@modelcontextprotocol/server'
import type { Caller } from '../../plugins/auth.ts'
import { VERSION } from '../../version.ts'
import { registerCoachingTools } from './coaching.ts'
import { registerDiagnosticTools } from './diagnostics.ts'
import { registerEquipmentTools } from './equipment.ts'
import { registerGroupTools } from './groups.ts'
import { registerInstanceTools } from './instance.ts'
import { registerLibraryTools } from './library.ts'
import { registerNoteTools, registerWeighInTools } from './athlete-file.ts'
import { registerSessionTools } from './session.ts'
import { registerTrainingTools } from './training.ts'

/** Every tool, by the task it serves. A new tools file is registered here, or none of it loads. */
export function registerTools(server: McpServer, caller: Caller): void {
  registerLibraryTools(server, caller)
  registerGroupTools(server, caller)
  registerEquipmentTools(server, caller)
  registerTrainingTools(server, caller)
  registerSessionTools(server, caller)
  registerCoachingTools(server, caller)
  registerNoteTools(server, caller)
  registerWeighInTools(server, caller)
  registerDiagnosticTools(server, caller, VERSION)
  registerInstanceTools(server, caller)
}
