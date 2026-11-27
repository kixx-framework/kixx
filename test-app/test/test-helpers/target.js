import process from 'node:process';
import { describe } from 'kixx-test';
import { assert, assertNonEmptyString, isFunction, isNonEmptyString } from 'kixx-assert';


// The targets the runner knows by name (`--local`, `--cloudflare`,
// `--nodejs`).
const TARGET_NAMES = Object.freeze([ 'local', 'cloudflare', 'nodejs' ]);


/**
 * Returns the integration target's base URL without a trailing slash.
 * @returns {string} Absolute HTTP or HTTPS target URL.
 * @throws {AssertionError} When INTEGRATION_TESTS_BASE_URL is not set
 */
export function getBaseUrl() {
    assertNonEmptyString(process.env.INTEGRATION_TESTS_BASE_URL, 'INTEGRATION_TESTS_BASE_URL');
    return process.env.INTEGRATION_TESTS_BASE_URL.replace(/\/$/, '');
}

/**
 * Returns the target's deploy key from INTEGRATION_TESTS_DEPLOY_KEY.
 *
 * The key is a secret. Send it only in a request's Authorization header, and
 * never print it, log it, or put it in an assertion message.
 *
 * @returns {string|null} The deploy key, or null when none is set.
 */
export function getDeployKey() {
    const deployKey = process.env.INTEGRATION_TESTS_DEPLOY_KEY;
    return isNonEmptyString(deployKey) ? deployKey : null;
}

/**
 * Returns the name of the target the runner was pointed at, from
 * INTEGRATION_TESTS_TARGET.
 *
 * @returns {'local'|'cloudflare'|'nodejs'|null} Null for a target given by
 *   URL (`--base-url`): nothing is known about it.
 */
export function getTarget() {
    const target = process.env.INTEGRATION_TESTS_TARGET;
    return TARGET_NAMES.includes(target) ? target : null;
}

/**
 * Registers a describe block only when the run's target is one of those
 * named. On any other target, and on one given by URL, it registers nothing,
 * so the block's tests are not reported at all.
 *
 * @param {string[]} targets - Any of `local`, `cloudflare`, `nodejs`.
 * @param {string} name - The block's name.
 * @param {Function} fn - The block, as for `describe`.
 * @param {Object} [opts] - As for `describe`.
 * @throws {AssertionError} When a target's name is not one the runner knows.
 */
export function describeOnTarget(targets, name, fn, opts) {
    assert(
        Array.isArray(targets) && targets.length > 0 && targets.every((target) => TARGET_NAMES.includes(target)),
        `describeOnTarget: targets must name one or more of ${ TARGET_NAMES.join(', ') }`,
    );
    assertNonEmptyString(name, 'describeOnTarget: name');
    assert(isFunction(fn), 'describeOnTarget: fn must be a function');

    if (targets.includes(getTarget())) {
        describe(name, fn, opts);
    }
}

/**
 * Sends a request to the target with the deploy key as a bearer token.
 *
 * Redirects aren't followed, so the key goes only to the target. An error
 * from here names the method and the path and nothing else: never the key,
 * a header, or the cause, which could hold one.
 *
 * @param {string} pathname - The path on the target, with a leading slash and any query string.
 * @param {Object} [init] - As for `fetch`. Its `authorization` header and `redirect` are replaced.
 * @returns {Promise<Response>}
 * @throws {AssertionError} When INTEGRATION_TESTS_DEPLOY_KEY is not set
 * @throws {Error} When the request fails
 */
export async function fetchWithDeployKey(pathname, init = {}) {
    assert(
        isNonEmptyString(pathname) && pathname.startsWith('/'),
        'fetchWithDeployKey: pathname must start with a slash',
    );

    const deployKey = getDeployKey();

    // The message must not show the value.
    assert(deployKey !== null, 'INTEGRATION_TESTS_DEPLOY_KEY must be set to call a protected route');

    const headers = new Headers(init.headers);

    headers.set('authorization', `Bearer ${ deployKey }`);

    try {
        return await fetch(`${ getBaseUrl() }${ pathname }`, { ...init, headers, redirect: 'manual' });
    } catch {
        throw new Error(`The request failed: ${ init.method ?? 'GET' } ${ pathname }`);
    }
}
