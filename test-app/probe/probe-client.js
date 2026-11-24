/**
 * The probe's client. It runs on the machine that runs the integration suite
 * and talks to the probe handler mounted in a target (see probe-handler.js
 * for the protocol).
 *
 * `createProbeClient()` lists and runs a remote suite's tests.
 * `describeProbeSuite()` turns a listed suite into local tests, one per remote
 * test, so the integration runner reports each on its own.
 *
 * Like the handler, this module uses only relative imports.
 */
import {
    assert,
    isFunction,
    isNonEmptyString,
    isPlainObject,
    isString,
} from '../../kixx/assertions/mod.js';


/**
 * @typedef {Object} ProbeTestResult
 * @property {string} suite - The suite's name.
 * @property {string[]} path - The test's path.
 * @property {'passed'|'failed'} status
 * @property {{ name: string, message: string, code: (string|undefined) }} [error] -
 *   What the test threw, when it failed.
 */

/**
 * @typedef {Object} ProbeClient
 * @property {function(string): Promise<string[][]>} listTests - Resolves the
 *   path of every test in the named suite, in registration order.
 * @property {function(string, string[]): Promise<ProbeTestResult>} runTest -
 *   Runs the test at the path in the named suite. Resolves for a failed test
 *   too; check `status`.
 */

/**
 * Creates a client for the probe mounted at a URL.
 *
 * Both methods reject with an `Error` named `ProbeRequestError` when the
 * probe answers anything but a 2xx, or a 2xx that isn't the probe's answer.
 * The error has the response's `status`, and its message carries the probe's
 * own error message. It never carries the deploy key or a request header.
 *
 * Redirects aren't followed, so the deploy key goes only to the URL given.
 *
 * @param {Object} options
 * @param {string} options.url - The probe's full URL on the target.
 * @param {string|null} [options.deployKey] - Sent as `Authorization: Bearer
 *   <key>` when given. A secret: the client never prints or returns it.
 * @param {Function} [options.fetch] - Used in place of the global `fetch`.
 * @returns {ProbeClient}
 * @throws {AssertionError} When an option is of the wrong type.
 */
export function createProbeClient(options) {
    const {
        url,
        deployKey,
        fetch: injectedFetch,
    } = options ?? {};

    assert(isNonEmptyString(url), 'createProbeClient: url must be a non-empty string');
    // The message must not show the value: it may be a mistyped secret.
    assert(
        deployKey === undefined || deployKey === null || isNonEmptyString(deployKey),
        'createProbeClient: deployKey must be a non-empty string when given',
    );
    assert(
        injectedFetch === undefined || isFunction(injectedFetch),
        'createProbeClient: fetch must be a function when given',
    );

    async function send(target, init) {
        const headers = { accept: 'application/json' };

        if (init.body) {
            headers['content-type'] = 'application/json';
        }

        if (deployKey) {
            headers.authorization = `Bearer ${ deployKey }`;
        }

        // A redirect would mean the URL is wrong, and following one could
        // carry the key somewhere else. It is reported as a failed request.
        const request = { ...init, headers, redirect: 'manual' };

        // The global is read on each request, not when the client is made.
        const response = injectedFetch
            ? await injectedFetch(target, request)
            : await fetch(target, request);

        const body = await readJSONBody(response);

        if (!response.ok) {
            const detail = isString(body?.error?.message) ? body.error.message : 'the response held no error message';
            throw createProbeRequestError(response.status, detail);
        }

        return { status: response.status, body };
    }

    return {
        async listTests(suite) {
            assert(isNonEmptyString(suite), 'ProbeClient#listTests: suite must be a non-empty string');

            const target = new URL(url);
            target.searchParams.set('suite', suite);

            const { status, body } = await send(target.href, { method: 'GET' });

            if (!Array.isArray(body?.tests) || !body.tests.every(isTestPath)) {
                throw createProbeRequestError(status, 'the response is not a list of test paths');
            }

            return body.tests;
        },

        async runTest(suite, path) {
            assert(isNonEmptyString(suite), 'ProbeClient#runTest: suite must be a non-empty string');
            assert(isTestPath(path), 'ProbeClient#runTest: path must be an array of strings');

            const { status, body } = await send(url, {
                method: 'POST',
                body: JSON.stringify({ suite, path }),
            });

            // Anything but a clear result is an error. A response from some
            // other server must never count as a passed test.
            const isPassed = body?.status === 'passed';
            const isFailed = body?.status === 'failed' && isPlainObject(body.error);

            if (!isPassed && !isFailed) {
                throw createProbeRequestError(status, 'the response is not a test result');
            }

            return body;
        },
    };
}

/**
 * Registers a remote suite with a local test runner: one `describe` block
 * named after the suite, holding one test per remote test. Each local test
 * runs its remote test through the client and fails with the remote error's
 * `name`, `message`, and `code`.
 *
 * It doesn't import a test runner. Pass the runner's `describe`.
 *
 * @example
 * // test-app/test/key-value-store.test.js
 * import { describe } from 'kixx-test';
 * import { createProbeClient, describeProbeSuite } from '../probe/probe-client.js';
 * import { getBaseUrl, getDeployKey } from './test-helpers/target.js';
 *
 * const client = createProbeClient({
 *     url: `${ getBaseUrl() }/path/the/probe/is/mounted/at`,
 *     deployKey: getDeployKey(),
 * });
 *
 * // The tests must be known before they can be registered, so list them
 * // while the file is imported.
 * const tests = await client.listTests('key-value-store');
 *
 * describeProbeSuite(describe, { client, suite: 'key-value-store', tests });
 *
 * @param {Function} describe - The runner's `describe`, or a nested one.
 * @param {Object} options
 * @param {ProbeClient} options.client - The client for the target's probe.
 * @param {string} options.suite - The suite's name.
 * @param {string[][]} options.tests - The suite's test paths, from `client.listTests()`.
 * @throws {AssertionError} When an option is of the wrong type, or `tests` is empty.
 */
export function describeProbeSuite(describe, options) {
    const {
        client,
        suite,
        tests,
    } = options ?? {};

    assert(isFunction(client?.runTest), 'describeProbeSuite: client must be a probe client');
    assert(isNonEmptyString(suite), 'describeProbeSuite: suite must be a non-empty string');
    // An empty list would register nothing, and nothing always passes.
    assert(
        Array.isArray(tests) && tests.length > 0 && tests.every(isTestPath),
        'describeProbeSuite: tests must be a non-empty list of test paths',
    );

    describe(suite, ({ it }) => {
        for (const path of tests) {
            it(path.join(' > '), async () => {
                const result = await client.runTest(suite, path);

                if (result.status !== 'passed') {
                    throw createRemoteTestError(result.error);
                }
            });
        }
    });
}


function isTestPath(value) {
    return Array.isArray(value) && value.every(isString);
}

async function readJSONBody(response) {
    try {
        return await response.json();
    } catch {
        // Not every server in front of a target answers in JSON.
        return null;
    }
}

function createProbeRequestError(status, detail) {
    const error = new Error(`The probe answered ${ status }: ${ detail }`);

    error.name = 'ProbeRequestError';
    error.status = status;

    return error;
}

function createRemoteTestError(remote) {
    const { name, message, code } = remote ?? {};

    const error = new Error(isString(message) ? message : 'The test failed on the target');

    if (isNonEmptyString(name)) {
        error.name = name;
    }

    if (isString(code)) {
        error.code = code;
    }

    return error;
}
