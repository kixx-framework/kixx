/**
 * The probe's request handler. It runs a shared test suite inside a running
 * server, against the bindings and runtime that server really has, and
 * returns the results as JSON.
 *
 * A suite is a function `suite(describe, factory)`, the form the shared
 * conformance suites take. The handler never runs a whole suite. A client
 * asks for the list of a suite's tests, then runs one test per request:
 *
 *     GET ?suite=<name>
 *         200 { suite, tests }
 *
 *     POST { suite, path }
 *         200 { suite, path, status: 'passed' }
 *         200 { suite, path, status: 'failed', error: { name, message, code? } }
 *
 * `tests` holds every test's path, in the order the suite registers them. A
 * path is the names from the suite's outermost `describe` down to the `it`,
 * as an array of strings. A failing test is still a 200: the request did its
 * job.
 *
 * Every other answer is `{ error: { name, message } }`:
 *
 *     400  the suite or path is missing or of the wrong type, or the body
 *          isn't JSON
 *     401  the request isn't authorized
 *     404  no suite has that name, the suite has no factory on this target,
 *          or the suite has no test at that path
 *
 * Suites register tests with `describe(name, fn)` and `it(name, fn)` only.
 * Hooks, `xit`, `xdescribe`, block options, disabled blocks, and
 * callback-style tests aren't supported, and a suite that uses one fails with
 * a `TypeError` when its tests are collected. The handler sets no timeout: the
 * client's own test runner ends a test that hangs.
 *
 * This module and everything it imports use only relative specifiers, so it
 * can be bundled into any target.
 */
import {
    assert,
    isFunction,
    isNonEmptyString,
    isPlainObject,
    isString,
} from '../../kixx/assertions/mod.js';


const MAX_ERROR_NAME_LENGTH = 100;
const MAX_ERROR_CODE_LENGTH = 100;
const MAX_ERROR_MESSAGE_LENGTH = 2000;


/**
 * @typedef {import('../../kixx/http-router/middleware-interface.js').MiddlewareFunction} MiddlewareFunction
 */

/**
 * @callback ProbeSuite
 * @param {Function} describe - Registers a group of tests: `describe(name, fn)`.
 * @param {Function} factory - Builds the subject under test. A suite calls it
 *   inside each test, never while registering tests.
 */

/**
 * @callback ProbeFactoryBuilder
 * @param {Object} context - The context of the request that runs the test.
 * @returns {Function} The factory to pass to the suite.
 */

/**
 * @callback ProbeAuthorize
 * @param {Object} context - The request's context.
 * @param {Object} request - The request.
 * @returns {boolean|Promise<boolean>} Exactly `true` to let the request through.
 */

/**
 * Creates the middleware that lists and runs the tests of the given suites.
 *
 * Mount it on a route that accepts GET and POST. It serves a GET as a listing
 * and treats any other request as a run, so the route's method list is what
 * turns other methods away.
 *
 * Every request is authorized first. Unless `authorize` resolves exactly
 * `true`, the answer is a 401 with a fixed body, and no suite or factory is
 * touched. A throw from `authorize` counts as a refusal.
 *
 * Listing collects a suite with a factory that throws, so it never touches
 * storage. A run builds the suite's factory from the request's context and
 * runs the one test. The error of a failed test is reduced to its `name`,
 * `message`, and string `code`, each cut to a fixed length. No stack, cause,
 * or other property leaves the server.
 *
 * An error thrown while a suite is collected, or by a factory builder, isn't
 * caught here. It reaches the router like any unexpected error.
 *
 * @param {Object} options
 * @param {Object<string, ProbeSuite>} options.suites - The suites, by name.
 * @param {Object<string, ProbeFactoryBuilder>} options.factories - For each
 *   suite this target can run, a function that builds its factory. A suite
 *   without one can be listed but not run.
 * @param {ProbeAuthorize} options.authorize - Decides whether a request may
 *   use the probe.
 * @returns {MiddlewareFunction}
 * @throws {AssertionError} When `authorize` isn't a function, or `suites` or
 *   `factories` isn't a plain object.
 */
export function createProbeHandler(options) {
    const {
        suites,
        factories,
        authorize,
    } = options ?? {};

    // Checked here, and not on the first request, so the probe can't be
    // mounted open by leaving the check out.
    assert(isFunction(authorize), 'createProbeHandler: authorize must be a function');
    assert(isPlainObject(suites), 'createProbeHandler: suites must be a plain object');
    assert(isPlainObject(factories), 'createProbeHandler: factories must be a plain object');

    return async function probeHandler(context, request, response) {
        if (!await isAuthorized(authorize, context, request)) {
            return respondWithError(response, 401, 'UnauthenticatedError', 'Unauthorized');
        }

        if (request.method === 'GET') {
            return listTests(suites, request, response);
        }

        return await runTest(suites, factories, context, request, response);
    };
}


// Fails closed: a rejection, a throw, and every result other than `true`
// (truthy ones included) are a refusal. Nothing about the failure is passed
// on, because an error from a credential check can carry the credential.
async function isAuthorized(authorize, context, request) {
    try {
        return await authorize(context, request) === true;
    } catch {
        return false;
    }
}

function listTests(suites, request, response) {
    const name = request.queryParams.suite;

    if (!isNonEmptyString(name)) {
        return respondWithError(response, 400, 'BadRequestError', 'The suite query parameter must name one suite');
    }

    if (!hasFunction(suites, name)) {
        return respondWithError(response, 404, 'NotFoundError', 'No suite has that name');
    }

    const tests = collectSuite(suites[name], forbiddenFactory);

    return response.respondWithJSON(200, {
        suite: name,
        tests: Array.from(tests.values(), ({ path }) => path),
    });
}

async function runTest(suites, factories, context, request, response) {
    const body = await readJSONBody(request);

    if (!isPlainObject(body) || !isNonEmptyString(body.suite) || !isTestPath(body.path)) {
        return respondWithError(
            response,
            400,
            'BadRequestError',
            'The request body must be a JSON object with a suite (a string) and a path (an array of strings)',
        );
    }

    const { suite: name, path } = body;

    if (!hasFunction(suites, name)) {
        return respondWithError(response, 404, 'NotFoundError', 'No suite has that name');
    }

    if (!hasFunction(factories, name)) {
        return respondWithError(response, 404, 'NotFoundError', 'No factory is configured for that suite on this target');
    }

    const tests = collectSuite(suites[name], factories[name](context));
    const test = tests.get(toPathKey(path));

    if (!test) {
        return respondWithError(response, 404, 'NotFoundError', 'The suite has no test at that path');
    }

    const result = { suite: name, path: test.path };

    try {
        await test.fn();
        result.status = 'passed';
    } catch (error) {
        result.status = 'failed';
        result.error = toErrorResult(error);
    }

    return response.respondWithJSON(200, result);
}

// Calls the suite with a `describe` that records tests and runs nothing.
// Returns the tests in registration order, as a Map from a path's key to
// `{ path, fn }`.
function collectSuite(suite, factory) {
    const tests = new Map();

    function createHandle(parentPath) {
        // Arguments past the two this collector supports are caught in
        // `rest`, so a block option fails here and isn't quietly ignored.
        function describe(name, fn, ...rest) {
            if (!isNonEmptyString(name) || !isFunction(fn) || rest.length > 0) {
                throw new TypeError(
                    'The probe supports only describe(name, fn): '
                    + `no block options or disabled blocks ("${ String(name) }")`,
                );
            }

            fn(createHandle([ ...parentPath, name ]));
        }

        function it(name, fn, ...rest) {
            // A test function that takes an argument is callback-style. The
            // probe would await it, get nothing, and report a pass.
            if (!isNonEmptyString(name) || !isFunction(fn) || fn.length > 0 || rest.length > 0) {
                throw new TypeError(
                    'The probe supports only it(name, fn) with a test function that takes no arguments: '
                    + `no block options, disabled tests, or callback-style tests ("${ String(name) }")`,
                );
            }

            const path = [ ...parentPath, name ];
            const key = toPathKey(path);

            // A path is the only name a client has for a test, so two tests
            // can't share one.
            if (tests.has(key)) {
                throw new Error(`The suite registers two tests at the path "${ path.join(' > ') }"`);
            }

            tests.set(key, { path, fn });
        }

        return { describe, it };
    }

    suite(createHandle([]).describe, factory);

    return tests;
}

function forbiddenFactory() {
    throw new Error('A suite must call its factory inside a test, never while registering tests');
}

// JSON keeps the boundaries between names, so [ 'a', 'b' ] and [ 'a,b' ]
// get different keys.
function toPathKey(path) {
    return JSON.stringify(path);
}

function isTestPath(value) {
    return Array.isArray(value) && value.every(isString);
}

// Own properties only, so a name such as "constructor" finds nothing.
function hasFunction(object, name) {
    return Object.hasOwn(object, name) && isFunction(object[name]);
}

async function readJSONBody(request) {
    try {
        return await request.json();
    } catch (error) {
        // A body that isn't JSON is the client's mistake. Anything else is a
        // bug, and goes to the router.
        if (error.name === 'BadRequestError') {
            return null;
        }
        throw error;
    }
}

// A thrown value can carry anything: a stack with server paths, a cause, a
// binding, a token. Only these three fields are copied, and a value that
// isn't an Error is never turned into a string.
function toErrorResult(error) {
    if (!(error instanceof Error)) {
        return { name: 'Error', message: 'A non-Error value was thrown' };
    }

    const result = {
        name: isString(error.name) ? error.name.slice(0, MAX_ERROR_NAME_LENGTH) : 'Error',
        message: isString(error.message) ? error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH) : '',
    };

    if (isString(error.code)) {
        result.code = error.code.slice(0, MAX_ERROR_CODE_LENGTH);
    }

    return result;
}

function respondWithError(response, status, name, message) {
    return response.respondWithJSON(status, { error: { name, message } });
}
