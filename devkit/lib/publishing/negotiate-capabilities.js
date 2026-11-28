/**
 * Publishing API capability negotiation.
 * @module publishing/negotiate-capabilities
 */

import { assert, isPlainObject } from '../vendor/kixx-assert/mod.js';
import UsageError from '../usage-error.js';

/**
 * Build pointer write protocol this client speaks.
 *
 * Protocol 4 requires every build write to declare an `intent`, `prestage` or
 * `publish`, and outside development requires a commit, code, and code
 * fingerprint, which this v6 client doesn't send: its writes work only
 * against a development server until the CLI is rebuilt. Protocol 3 added the
 * deploy key and refused unknown build attributes.
 *
 * Protocol 2 carries the compare-and-swap precondition in the request body as
 * `attributes.expectedAssignmentId`. Protocol 1 carried it in `If-Match` and
 * `If-None-Match`, which a protocol 2 server rejects outright. There is no
 * fallback: the two generations cannot write through one code path.
 * @type {number}
 * @readonly
 */
export const BUILD_ASSIGNMENT_PROTOCOL_VERSION = 4;

/**
 * An application environment this client cannot safely write to.
 *
 * Reported as a usage failure rather than a crash because the resolution is
 * always an operator action: upgrade the deployment or target another one.
 */
export class UnsupportedServerError extends UsageError {}

/**
 * @typedef {Object} ExpectedContract
 * @property {number} contentContractVersion - The Release manifest contract the project's content compiler writes
 * @property {number} addressingFormat - The addressing format the project's content compiler hashes with
 */

/**
 * Reads server capabilities and refuses an environment this client cannot write to.
 *
 * The content contract and the addressing format describe what the project's
 * own content compiler writes, so the caller passes them in from the
 * project's Kixx. The build assignment protocol describes the requests this
 * client sends, so it is pinned here.
 *
 * Call this before the first write of any kind — object upload, Release
 * creation, or build pointer assignment. Discovery is memoized by the client,
 * so calling it on every write path costs one request per process.
 * @param {Object} client - Publishing API client
 * @param {ExpectedContract} expected - What the project's Kixx composes
 * @returns {Promise<Object>} Discovery attributes, including enforced limits
 * @throws {UnsupportedServerError} When the server is incompatible with this client
 */
export default async function negotiateCapabilities(client, expected) {
    assert(isPlainObject(expected), 'negotiateCapabilities() requires the expected contract versions');

    const { contentContractVersion, addressingFormat } = expected;

    assert(
        Number.isInteger(contentContractVersion),
        'negotiateCapabilities() expected.contentContractVersion must be an integer',
    );
    assert(
        Number.isInteger(addressingFormat),
        'negotiateCapabilities() expected.addressingFormat must be an integer',
    );

    const capabilities = await client.discover();
    const failures = [];

    if (capabilities.contentContractVersion !== contentContractVersion) {
        failures.push(
            `Content contract: server reports ${ describe(capabilities.contentContractVersion) }; ` +
            `this client composes ${ contentContractVersion }.`,
        );
    }

    if (capabilities.addressingFormat !== addressingFormat) {
        failures.push(
            `Addressing format: server reports ${ describe(capabilities.addressingFormat) }; ` +
            `this client computes ${ addressingFormat }.`,
        );
    }

    // An absent protocol version is the legacy header-based protocol, not a
    // malformed response: the field did not exist before protocol 2.
    if (capabilities.buildAssignmentProtocolVersion !== BUILD_ASSIGNMENT_PROTOCOL_VERSION) {
        const reported = capabilities.buildAssignmentProtocolVersion;
        failures.push(
            'Build assignment protocol: server reports ' +
            `${ reported === undefined ? 'none, identifying the legacy protocol' : describe(reported) }; ` +
            `this client writes ${ BUILD_ASSIGNMENT_PROTOCOL_VERSION } only.`,
        );
    }

    // Report every mismatch at once. An un-upgraded deployment fails more than
    // one check, and learning them one command at a time wastes a cutover.
    if (failures.length > 0) {
        throw new UnsupportedServerError(
            'The target application environment is incompatible with this version of the devkit. ' +
            'Upgrade the deployment to a Kixx release serving build assignment protocol ' +
            `${ BUILD_ASSIGNMENT_PROTOCOL_VERSION } and addressing format ${ addressingFormat }, ` +
            'or target an environment that already serves them.\n' +
            failures.map((failure) => `  - ${ failure }`).join('\n'),
        );
    }

    return capabilities;
}

function describe(value) {
    return value === undefined ? 'none' : JSON.stringify(value);
}
