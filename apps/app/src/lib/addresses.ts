/**
 * Where a session, or an exercise's history, is read — by whose it is (#30): your own, or an
 * athlete's read by their coach. The parts that open one take where, so one part serves both.
 */
export const ownSession = (sessionId: string): string => `/today/session/${sessionId}`

export const athleteSession =
  (athleteId: string) =>
  (sessionId: string): string =>
    `/athletes/${athleteId}/sessions/${sessionId}`

export const athleteExercise =
  (athleteId: string) =>
  (exerciseId: string): string =>
    `/athletes/${athleteId}/exercises/${exerciseId}`
