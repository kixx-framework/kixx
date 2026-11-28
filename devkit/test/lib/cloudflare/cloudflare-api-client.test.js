import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertNotMatches,
    assertUndefined,
} from '../../../lib/vendor/kixx-assert/mod.js';

import CloudflareAPIClient from '../../../lib/cloudflare/cloudflare-api-client.js';

const ACCOUNT_ID = 'account-id';
const API_TOKEN = 'cf-api-token-secret';
const ACCOUNT_BASE = `https://api.cloudflare.com/client/v4/accounts/${ ACCOUNT_ID }`;
const VERIFY_URL = 'https://api.cloudflare.com/client/v4/user/tokens/verify';


describe('cloudflare/cloudflare-api-client', ({ it }) => {

    it('rejects missing constructor and method arguments before a request', async () => {
        assert(catchError(() => new CloudflareAPIClient({ apiToken: API_TOKEN })), 'accountId');
        assert(catchError(() => new CloudflareAPIClient({ accountId: ACCOUNT_ID })), 'apiToken');

        const fetchMock = makeRecordingFetch(() => envelope(true, {}));
        const client = makeClient(fetchMock);
        const calls = [
            [ () => client.createWorker(), 'requires a payload' ],
            [ () => client.createWorker({}), 'requires a payload.name' ],
            [ () => client.getWorker(), 'requires a workerId' ],
            [ () => client.updateWorker('worker'), 'requires a payload' ],
            [ () => client.listWorkerVersions(), 'requires a workerId' ],
            [ () => client.listWorkerVersions('worker', { page: 0 }), 'positive integer' ],
            [ () => client.listWorkerVersions('worker', { per_page: 1.5 }), 'positive integer' ],
            [ () => client.getWorkerVersion('worker'), 'requires a versionId' ],
            [ () => client.createWorkerVersion('worker'), 'requires a version' ],
            [ () => client.createWorkerVersion('worker', {}, { deploy: 'yes' }), 'deploy must be a boolean' ],
            [ () => client.createWorkerVersion('worker', {}, { strictBindingsInheritance: 1 }), 'must be a boolean' ],
            [ () => client.createDeployment('worker'), 'requires a deployment' ],
            [ () => client.getKVNamespace(), 'requires a namespaceId' ],
            [ () => client.getD1Database(), 'requires a databaseId' ],
            [ () => client.getR2Bucket(), 'requires a bucketName' ],
            [ () => client.getR2Bucket('bucket', { jurisdiction: '' }), 'jurisdiction' ],
        ];

        for (const [ call, message ] of calls) {
            // eslint-disable-next-line no-await-in-loop
            const caught = await catchAsyncError(call);
            assert(caught, `expected rejection: ${ message }`);
            assertMatches(message, caught.message);
        }

        assertEqual(0, fetchMock.calls.length);
    });

    it('sends each kept method to its URL with method, query, headers, and body', async () => {
        const fetchMock = makeRecordingFetch(() => envelope(true, { ok: true }));
        const client = makeClient(fetchMock);

        await client.createWorker({ name: 'w' });
        await client.getWorker('w');
        await client.updateWorker('w', { name: 'w', logpush: false });
        await client.listWorkerVersions('w');
        await client.listWorkerVersions('w', { page: 2, per_page: 1 });
        await client.getWorkerVersion('w', 'v1');
        await client.createWorkerVersion('w', { modules: [] });
        await client.createWorkerVersion('w', { modules: [] }, { deploy: false, strictBindingsInheritance: true });
        await client.createDeployment('w', { strategy: 'percentage', versions: [] });
        await client.getKVNamespace('kv1');
        await client.getD1Database('d1');
        await client.getR2Bucket('files');
        await client.getR2Bucket('files', { jurisdiction: 'eu' });

        const expected = [
            [ 'POST', `${ ACCOUNT_BASE }/workers/workers` ],
            [ 'GET', `${ ACCOUNT_BASE }/workers/workers/w` ],
            [ 'PUT', `${ ACCOUNT_BASE }/workers/workers/w` ],
            [ 'GET', `${ ACCOUNT_BASE }/workers/workers/w/versions?page=1&per_page=3` ],
            [ 'GET', `${ ACCOUNT_BASE }/workers/workers/w/versions?page=2&per_page=1` ],
            [ 'GET', `${ ACCOUNT_BASE }/workers/workers/w/versions/v1` ],
            [ 'POST', `${ ACCOUNT_BASE }/workers/workers/w/versions` ],
            [ 'POST', `${ ACCOUNT_BASE }/workers/workers/w/versions?deploy=false&bindings_inherit=strict` ],
            [ 'POST', `${ ACCOUNT_BASE }/workers/scripts/w/deployments` ],
            [ 'GET', `${ ACCOUNT_BASE }/storage/kv/namespaces/kv1` ],
            [ 'GET', `${ ACCOUNT_BASE }/d1/database/d1` ],
            [ 'GET', `${ ACCOUNT_BASE }/r2/buckets/files` ],
            [ 'GET', `${ ACCOUNT_BASE }/r2/buckets/files` ],
        ];

        assertEqual(expected.length, fetchMock.calls.length);

        expected.forEach(([ method, href ], index) => {
            const call = fetchMock.calls[index];
            assertEqual(method, call.init.method, `call ${ index } method`);
            assertEqual(href, call.url.href, `call ${ index } url`);
            assertEqual(`Bearer ${ API_TOKEN }`, call.init.headers.authorization, `call ${ index } auth`);

            if (method === 'GET') {
                assertUndefined(call.init.body, `call ${ index } body`);
            } else {
                assertEqual('application/json', call.init.headers['content-type'], `call ${ index } type`);
            }
        });

        assertEqual('{"name":"w","logpush":false}', fetchMock.calls[2].init.body);
        assertEqual('{"strategy":"percentage","versions":[]}', fetchMock.calls[8].init.body);
        assertUndefined(fetchMock.calls[11].init.headers['cf-r2-jurisdiction']);
        assertEqual('eu', fetchMock.calls[12].init.headers['cf-r2-jurisdiction']);
    });

    it('never sends a force parameter with a deployment', async () => {
        const fetchMock = makeRecordingFetch(() => envelope(true, {}));

        await makeClient(fetchMock).createDeployment('w', { strategy: 'percentage', versions: [] }, { force: true });

        assertEqual(null, fetchMock.calls[0].url.searchParams.get('force'));
    });

    it('unwraps the result from a successful envelope', async () => {
        const fetchMock = makeRecordingFetch(() => envelope(true, { id: 'worker-id', name: 'w' }));

        const result = await makeClient(fetchMock).getWorker('w');

        assertEqual('worker-id', result.id);
    });

    it('reports the first error message from an unsuccessful envelope', async () => {
        const fetchMock = makeRecordingFetch(() => jsonResponse(200, {
            success: false,
            errors: [ { code: 10021, message: 'Validation failed' } ],
            messages: [],
        }));

        const error = await catchAsyncError(() => makeClient(fetchMock).getWorker('w'));

        assertEqual('CloudflareApiError', error.name);
        assertEqual(200, error.status);
        assertEqual(10021, error.errors[0].code);
        assertMatches('API error "Validation failed" from GET', error.message);
        assertEqual(null, error.tokenStatus);
    });

    it('falls back to the first message when an unsuccessful envelope has no error', async () => {
        const fetchMock = makeRecordingFetch(() => jsonResponse(200, {
            success: false,
            errors: [],
            messages: [ { message: 'Try later' } ],
        }));

        const error = await catchAsyncError(() => makeClient(fetchMock).getWorker('w'));

        assertMatches('API error "Try later"', error.message);
    });

    it('parses the error envelope from a non-2xx response without verifying the token', async () => {
        const fetchMock = makeRecordingFetch(() => jsonResponse(404, {
            success: false,
            errors: [ { code: 10007, message: 'This Worker does not exist' } ],
        }));

        const error = await catchAsyncError(() => makeClient(fetchMock).getWorker('w'));

        assertEqual(404, error.status);
        assertEqual(10007, error.errors[0].code);
        assertEqual('GET', error.method);
        assertEqual(`${ ACCOUNT_BASE }/workers/workers/w`, error.url);
        assertMatches('Unexpected HTTP status 404', error.message);
        assertEqual(null, error.tokenStatus);
        assertEqual(1, fetchMock.calls.length);
    });

    it('tolerates a non-JSON error body', async () => {
        const fetchMock = makeRecordingFetch(() => new Response('<html>bad gateway</html>', { status: 502 }));

        const error = await catchAsyncError(() => makeClient(fetchMock).getWorker('w'));

        assertEqual(502, error.status);
        assertEqual(0, error.errors.length);
        assertMatches('bad gateway', error.message);
    });

    it('marks the token invalid when an auth failure is followed by a rejected verification', async () => {
        const fetchMock = makeRecordingFetch((url) => {
            if (url.href === VERIFY_URL) {
                return jsonResponse(401, { success: false, errors: [ { code: 1000, message: 'Invalid API Token' } ] });
            }
            return jsonResponse(403, { success: false, errors: [ { code: 10000, message: 'Authentication error' } ] });
        });

        const error = await catchAsyncError(() => makeClient(fetchMock).getWorker('w'));

        assertEqual(403, error.status);
        assertEqual('invalid', error.tokenStatus);
        assertEqual(VERIFY_URL, fetchMock.calls[1].url.href);
        assertEqual(`Bearer ${ API_TOKEN }`, fetchMock.calls[1].init.headers.authorization);
    });

    it('marks the token valid when only the request was refused', async () => {
        const fetchMock = makeRecordingFetch((url) => {
            if (url.href === VERIFY_URL) {
                return envelope(true, { status: 'active' });
            }
            return jsonResponse(403, { success: false, errors: [] });
        });

        const error = await catchAsyncError(() => makeClient(fetchMock).getWorker('w'));

        assertEqual('valid', error.tokenStatus);
    });

    it('reports token verification verdicts', async () => {
        const cases = [
            [ () => envelope(true, { status: 'active' }), 'valid', 'active' ],
            [ () => envelope(true, { status: 'expired' }), 'invalid', 'expired' ],
            [ () => jsonResponse(401, { success: false, errors: [] }), 'invalid', null ],
            [ () => jsonResponse(500, { success: false, errors: [] }), 'unknown', null ],
            [ throwNetworkError, 'unknown', null ],
        ];

        for (const [ respond, status, detail ] of cases) {
            // eslint-disable-next-line no-await-in-loop
            const verification = await makeClient(makeRecordingFetch(respond)).verifyToken();
            assertEqual(status, verification.status);
            assertEqual(detail, verification.detail);
        }
    });

    it('redacts the API token from error messages and error arrays', async () => {
        const echo = `token ${ API_TOKEN } is wrong`;
        const nonOk = makeRecordingFetch(() => jsonResponse(400, {
            success: false,
            errors: [ { code: 1, message: echo } ],
        }));
        const unsuccessful = makeRecordingFetch(() => jsonResponse(200, {
            success: false,
            errors: [ { code: 1, message: echo } ],
        }));

        for (const fetchMock of [ nonOk, unsuccessful ]) {
            // eslint-disable-next-line no-await-in-loop
            const error = await catchAsyncError(() => makeClient(fetchMock).getWorker('w'));

            assertNotMatches(API_TOKEN, error.message);
            assertNotMatches(API_TOKEN, JSON.stringify(error.errors));
            assertMatches('[redacted]', error.message);
        }
    });
});

function makeClient(fetchMock) {
    return new CloudflareAPIClient({ accountId: ACCOUNT_ID, apiToken: API_TOKEN, fetch: fetchMock });
}

function makeRecordingFetch(respond) {
    const calls = [];

    async function fetchMock(url, init) {
        calls.push({ url, init });
        return respond(url, init);
    }

    fetchMock.calls = calls;
    return fetchMock;
}

function envelope(success, result) {
    return jsonResponse(200, { success, errors: [], messages: [], result });
}

function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function throwNetworkError() {
    throw new TypeError('network down');
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
