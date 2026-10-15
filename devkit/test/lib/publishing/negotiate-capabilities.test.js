import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';

import { FORMAT } from '../../../lib/publishing/addressing.js';
import negotiateCapabilities, {
    BUILD_ASSIGNMENT_PROTOCOL_VERSION,
    CONTENT_CONTRACT_VERSION,
} from '../../../lib/publishing/negotiate-capabilities.js';


describe('publishing/negotiate-capabilities', ({ it }) => {
    it('accepts a server serving format 4 and assignment protocol 2', async () => {
        const client = makeClient();

        const capabilities = await negotiateCapabilities(client);

        assertEqual(1, client.discoveryCount);
        assertEqual(4, capabilities.addressingFormat);
        assertEqual(26_214_400, capabilities.limits.maxObjectBytes);
    });

    it('pins the versions this client speaks', () => {
        assertEqual(1, CONTENT_CONTRACT_VERSION);
        assertEqual(2, BUILD_ASSIGNMENT_PROTOCOL_VERSION);
        assertEqual(4, FORMAT);
    });

    it('ignores capabilities it does not recognize', async () => {
        const client = makeClient({ somethingNewer: 'ignored' });

        const capabilities = await negotiateCapabilities(client);

        assertEqual('ignored', capabilities.somethingNewer);
    });

    it('rejects a mismatched content contract', async () => {
        const client = makeClient({ contentContractVersion: 2 });

        const caught = await catchAsyncError(() => negotiateCapabilities(client));

        assertEqual('UnsupportedServerError', caught.name);
        assertMatches('Content contract: server reports 2; this client composes 1.', caught.message);
    });

    it('rejects a mismatched addressing format', async () => {
        const client = makeClient({ addressingFormat: 3 });

        const caught = await catchAsyncError(() => negotiateCapabilities(client));

        assertEqual('UnsupportedServerError', caught.name);
        assertMatches('Addressing format: server reports 3; this client computes 4.', caught.message);
    });

    it('reports an absent assignment protocol version as the legacy protocol', async () => {
        const client = makeClient({ buildAssignmentProtocolVersion: undefined });

        const caught = await catchAsyncError(() => negotiateCapabilities(client));

        assertEqual('UnsupportedServerError', caught.name);
        assertMatches('server reports none, identifying the legacy protocol', caught.message);
        assertMatches('this client writes 2 only.', caught.message);
    });

    it('rejects an assignment protocol version this client does not speak', async () => {
        const client = makeClient({ buildAssignmentProtocolVersion: 3 });

        const caught = await catchAsyncError(() => negotiateCapabilities(client));

        assertEqual('UnsupportedServerError', caught.name);
        assertMatches('Build assignment protocol: server reports 3;', caught.message);
    });

    it('reports every mismatch at once', async () => {
        const client = makeClient({
            contentContractVersion: 2,
            addressingFormat: 3,
            buildAssignmentProtocolVersion: undefined,
        });

        const caught = await catchAsyncError(() => negotiateCapabilities(client));

        assertMatches('Content contract:', caught.message);
        assertMatches('Addressing format:', caught.message);
        assertMatches('Build assignment protocol:', caught.message);
    });

    it('reports an incompatible server as operator instructions', async () => {
        const client = makeClient({ addressingFormat: 3 });

        const caught = await catchAsyncError(() => negotiateCapabilities(client));

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

        const caught = await catchAsyncError(() => negotiateCapabilities(client));

        assertEqual(failure, caught);
    });
});

function makeClient(overrides) {
    const capabilities = {
        runningBuildId: 'production',
        contentContractVersion: 1,
        addressingFormat: 4,
        buildAssignmentProtocolVersion: 2,
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
