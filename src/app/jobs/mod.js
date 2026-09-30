/**
 * Statically registered background jobs, keyed by job name. Handlers are
 * imported statically; no dynamic import() is allowed by the deployment
 * tooling. The JobQueue service validates this registry through
 * validateJobRegistry() when app.register() hands it over.
 *
 * Entry shape: { name, description, handler, maxAttempts?, timeoutSeconds?, schedule?: { cron } }
 * @type {Map<string, Object>}
 */
export const jobs = new Map([]);
