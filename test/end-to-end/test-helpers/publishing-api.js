import process from 'node:process';
import { isNonEmptyString } from 'kixx-assert';


// Every Publishing API write is namespaced by the build id in the
// `kixx-build-id` request header. Generate a fresh one per test run so writes
// land in a throwaway namespace: the running site never reads it, and it can
// never collide with the current build, which putTemplate() rejects with a 409.
//
// Nothing removes these namespaces afterward — the Publishing API has no delete
// route — so the `e2e-` prefix marks them as test litter for whoever cleans up.
export const TEST_BUILD_ID = `e2e-${ crypto.randomUUID() }`;

/**
 * Returns the target deployment's current build id, when the run was configured
 * with one.
 *
 * This is the inverse of TEST_BUILD_ID: writes addressed to it must be *refused*
 * with a 409, because the live site is reading that namespace and a publish must
 * never mutate the build it is serving. The value cannot be discovered over
 * HTTP — the app reads it from the BUILD_ID environment variable and exposes it
 * in no response — so it has to be supplied out of band, by
 * `E2E_TESTS_BUILD_ID` or the `--build-id` option.
 *
 * A local dev server has no current build at all (nothing in this repository
 * sets BUILD_ID), which is why this is optional and returns null rather than
 * asserting. Callers gate their describe blocks on the result.
 * @returns {string|null} The configured current build id, or null when the run did not supply one.
 */
export function getCurrentBuildId() {
    const buildId = process.env.E2E_TESTS_BUILD_ID;
    return isNonEmptyString(buildId) ? buildId : null;
}
