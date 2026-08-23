/**
 * The instance's version, reported by `/health`, `/admin/status` and the MCP handshake.
 *
 * One constant, because a stranger reporting a problem gives whichever number their client shows,
 * and three sources that could drift would make that number useless.
 */
export const VERSION = '0.0.0'
