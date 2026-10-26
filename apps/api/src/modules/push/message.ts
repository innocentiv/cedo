import { type RestAlert, restAlertOf } from '@cedo/contract'
import type { Caller } from '../../plugins/auth.ts'
import { targetsForSession } from '../progression/targets.ts'
import { get as getSession } from '../session/plan.ts'
import { own } from '../session/service.ts'

/**
 * The alert for a session's rest (#38), as its athlete would read the next set — their own names,
 * targets and unit, read as they would read them — and the session it opens.
 */
export async function restAlertFor(caller: Caller, sessionId: string): Promise<RestAlert> {
  const [session, targets] = await Promise.all([
    getSession(own(caller), sessionId),
    targetsForSession(caller, sessionId),
  ])
  const day = session.plan !== null && session.plan.reachable ? session.plan.day : null
  return {
    ...restAlertOf(day, session.logs, targets, caller.weightUnit),
    url: `/today/session/${sessionId}`,
  }
}
