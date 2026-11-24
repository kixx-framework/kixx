/**
 * The suites the probe can run, by name.
 *
 * The map is static on purpose. The probe is bundled into each target, and
 * the bundler follows static imports only, so a suite it can't see here
 * isn't in the build. To register a suite, import it and add it to
 * `PROBE_SUITES`.
 *
 * A registered suite, and everything it imports, uses only relative
 * specifiers. The rules for writing one are in `test/README.md`, under
 * "Shared Conformance Suites".
 */
import contentStoreConformance from '../../test/kixx/content-addressable-store/content-store-conformance.js';
import serverRequestConformance from '../../test/kixx/http-router/server-request-conformance.js';
import formatDateGoldens from '../../test/kixx/hyperview/helpers/format-date-goldens.js';
import keyValueStoreConformance from '../../test/kixx/key-value-store/key-value-store-conformance.js';
import loggerWriterConformance from '../../test/kixx/logger/logger-writer-conformance.js';
import formatDate from '../../kixx/hyperview/helpers/format-date.js';


/**
 * Every suite the probe can list, as `suite(describe, factory)` functions.
 * Pass it to `createProbeHandler()` as `suites`.
 * @type {Object<string, Function>}
 */
export const PROBE_SUITES = Object.freeze({
    'content-store': contentStoreConformance,
    'format-date': formatDateGoldens,
    'key-value-store': keyValueStoreConformance,
    'logger-writer': loggerWriterConformance,
    'server-request': serverRequestConformance,
});

/**
 * Factory builders for the suites that need nothing from a target but its
 * runtime and the code deployed there. Each takes the request's context and
 * returns the factory its suite calls.
 *
 * The four port suites have no entry. A port's factory builds that target's
 * own adapter over that target's own bindings, so the app that mounts the
 * probe supplies it, beside these, as `createProbeHandler()`'s `factories`.
 * A suite with no factory on a target can be listed there but not run.
 * @type {Object<string, Function>}
 */
export const BUILT_IN_FACTORIES = Object.freeze({
    'format-date': () => () => ({ formatDate }),
});
