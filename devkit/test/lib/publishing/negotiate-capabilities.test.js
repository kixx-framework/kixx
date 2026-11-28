import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';

import * as negotiateCapabilitiesModule from '../../../lib/publishing/negotiate-capabilities.js';
import negotiateCapabilities, {
    BUILD_ASSIGNMENT_PROTOCOL_VERSION,
} from '../../../lib/publishing/negotiate-capabilities.js';


// What the project's Kixx composes; the caller passes it in.
const EXPECTED = Object.freeze({ contentContractVersion: 2, addressingFormat: 4 });


describe('publishing/negotiate-capabilities', ({ it }) => {
    it('accepts a server serving format 4 and assignment protocol 4', async () => {
        const client = makeClient();

        const capabilities = await negotiateCapabilities(client, EXPECTED);

        assertEqual(1, client.discoveryCount);
        assertEqual(4, capabilities.addressingFormat);
        assertEqual(26_214_400, capabilities.limits.maxObjectBytes);
    });

    it('pins only the protocol of the requests this client sends', () => {
        assertEqual(4, BUILD_ASSIGNMENT_PROTOCOL_VERSION);
        assertEqual(
            'BUILD_ASSIGNMENT_PROTOCOL_VERSION,UnsupportedServerError,default',
            Object.keys(negotiateCapabilitiesModule).toSorted().join(','),
        );
    });

    it('compares the server with the versions it is given', async () => {
        const expected = { contentContractVersion: 3, addressingFormat: 5 };

        const accepted = await negotiateCapabilities(
            makeClient({ contentContractVersion: 3, addressingFormat: 5 }),
            expected,
        );
        const caught = await catchAsyncError(() => negotiateCapabilities(makeClient(), expected));

        assertEqual(5, accepted.addressingFormat);
        assertMatches('Content contract: server reports 2; this client composes 3.', caught.message);
        assertMatches('Addressing format: server reports 4; this client computes 5.', caught.message);
        assertMatches('build assignment protocol 4 and addressing format 5,', caught.message);
    });

    it('requires the expected versions before any request', async () => {
        for (const expected of [
            undefined,
            {},
            { contentContractVersion: 2 },
            { addressingFormat: 4 },
            { contentContractVersion: '2', addressingFormat: 4 },
        ]) {
            const client = makeClient();
            const caught = await catchAsyncError(() => negotiateCapabilities(client, expected));

            assertEqual('AssertionError', caught?.name);
            assertEqual(0, client.discoveryCount);
        }
    });

    it('ignores capabilities it does not recognize', async () => {
        const client = makeClient({ somethingNewer: 'ignored' });

        const capabilities = await negotiateCapabilities(client, EXPECTED);

        assertEqual('ignored', capabilities.somethingNewer);
    });

    it('rejects a mismatched content contract', async () => {
        const client = makeClient({ contentContractVersion: 1 });

        const caught = await catchAsyncError(() => negotiateCapabilities(client, EXPECTED));

        assertEqual('UnsupportedServerError', caught.name);
        assertMatches('Content contract: server reports 1; this client composes 2.', caught.message);
    });

    it('rejects a mismatched addressing format', async () => {
        const client = makeClient({ addressingFormat: 3 });

        const caught = await catchAsyncError(() => negotiateCapabilities(client, EXPECTED));

        assertEqual('UnsupportedServerError', caught.name);
        assertMatches('Addressing format: server reports 3; this client computes 4.', caught.message);
    });

    it('reports an absent assignment protocol version as the legacy protocol', async () => {
        const client = makeClient({ buildAssignmentProtocolVersion: undefined });

        const caught = await catchAsyncError(() => negotiateCapabilities(client, EXPECTED));

        assertEqual('UnsupportedServerError', caught.name);
        assertMatches('server reports none, identifying the legacy protocol', caught.message);
        assertMatches('this client writes 4 only.', caught.message);
    });

    it('rejects an assignment protocol version this client does not speak', async () => {
        const client = makeClient({ buildAssignmentProtocolVersion: 3 });

        const caught = await catchAsyncError(() => negotiateCapabilities(client, EXPECTED));

        assertEqual('UnsupportedServerError', caught.name);
        assertMatches('Build assignment protocol: server reports 3;', caught.message);
    });

    it('reports every mismatch at once', async () => {
        const client = makeClient({
            contentContractVersion: 1,
            addressingFormat: 3,
            buildAssignmentProtocolVersion: undefined,
        });

        const caught = await catchAsyncError(() => negotiateCapabilities(client, EXPECTED));

        assertMatches('Content contract:', caught.message);
        assertMatches('Addressing format:', caught.message);
        assertMatches('Build assignment protocol:', caught.message);
    });

    it('reports an incompatible server as operator instructions', async () => {
        const client = makeClient({ addressingFormat: 3 });

        const caught = await catchAsyncError(() => negotiateCapabilities(client, EXPECTED));

        // The CLI prints UsageError without a stack, because the resolution is
        // upgrading the deployment rather than debugging this tool.
        assert(caught instanceof Error);
        assertEqual('UnsupportedServerError', caught.code);
        assertMatches('Upgrade the deployment', caught.message);
    });

    it('propagates a discovery failure unchanged', async () => {
        const failure = new Error('network down');
        const client = {
            discoveryCount: 0,
            discover() {
                return Promise.reject(failure);
            },
        };

        const caught = await catchAsyncError(() => negotiateCapabilities(client, EXPECTED));

        assertEqual(failure, caught);
    });
});

function makeClient(overrides) {
    const capabilities = {
        runningBuildId: 'production',
        contentContractVersion: 2,
        addressingFormat: 4,
        buildAssignmentProtocolVersion: 4,
        limits: {
            maxObjectBytes: 26_214_400,
            maxObjectStatusIds: 100,
            maxManifestEntries: 10_000,
        },
        ...overrides,
    };

    return {
        discoveryCount: 0,
        async discover() {
            this.discoveryCount += 1;
            return await Promise.resolve(capabilities);
        },
    };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
