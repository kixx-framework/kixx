// Publishes content to a running app through its Publishing API, over HTTP,
// as a client outside development must (protocol 4). It is not a test file:
// the runner collects only `*.test.js`.
//
// The deploy key is a secret. It is sent only in the Authorization header,
// and no error made here holds it.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { compileContent, serializeContentObject } from '../../../kixx/tooling/mod.js';
import { createMemoryContentSource, listContentDirectories } from '../../../kixx/content-compiler/mod.js';
import { createFileSystemContentSource } from '../../../kixx/adapters/node/content-compiler/lib/file-system-content-source.js';
import { getBaseUrl, getDeployKey } from './target.js';


const PROTOCOL_VERSION = 4;
const CONTENT_CONTRACT_VERSION = 2;
const ADDRESSING_FORMAT = 4;

const JSON_API = 'application/vnd.api+json';

// Made up, and well formed: a server can't see git, so it checks only the
// form of a commit id and a code fingerprint. A caller that publishes twice
// to one build passes the same values, or leaves them out.
export const DEFAULT_SOURCE_REVISION = '5131300000000000000000000000000000000000';
export const DEFAULT_CODE_FINGERPRINT = `kxfp1:${ '51313'.padEnd(64, '0') }`;

// The test app's content is the project skeleton's own, plus the one page
// of its plugin. The plugin adds no template helper to core's.
const SKELETON_DIRECTORY = fileURLToPath(new URL('../../../devkit/templates/project', import.meta.url));
const PLUGIN_DIRECTORY = fileURLToPath(new URL('../../integration-probe', import.meta.url));

// As the built test app's registries export it (`contentRoots`).
const PLUGIN_CONTENT_ROOTS = Object.freeze([
    Object.freeze({ plugin: 'integration-probe', pagesDirectory: 'plugins/integration-probe/pages' }),
]);
const CORE_MANIFEST_FILE = fileURLToPath(new URL('../../../kixx/plugin.json', import.meta.url));

let testAppContent = null;
let published = null;


/**
 * Reads the test app's content: every content file of the project skeleton
 * and of the plugin, by its path from the project root of the built test
 * app. Read once for the run.
 *
 * @returns {Promise<Object<string, Uint8Array>>} A new object on each call, so a caller may add files to it
 */
export async function readTestAppContent() {
    testAppContent ??= readContent();

    return { ...await testAppContent };
}

/**
 * Publishes the test app's content, with any extra files, to the build the
 * integration target runs, and assigns it. The target and the deploy key
 * come from the environment (see target.js), unless a test names a server
 * it started itself.
 *
 * Every test's Release holds the skeleton's files, so the skeleton's pages
 * render whichever Release was assigned last.
 *
 * @param {Object<string, Uint8Array|string>} [extraFiles] - Content files to add, by their path from the project root
 * @param {Object} [target] - Another test app to publish to
 * @param {string} [target.baseUrl] - Its origin
 * @param {string|null} [target.deployKey] - Its deploy key
 * @returns {Promise<{ releaseId: string, buildId: string, assignmentId: string, intent: string, uploaded: number }>}
 */
export async function publishTestAppContent(extraFiles = {}, target = {}) {
    const { baseUrl = getBaseUrl(), deployKey = getDeployKey() } = target;
    const { templateHelpers } = JSON.parse(fs.readFileSync(CORE_MANIFEST_FILE, 'utf8'));

    return publishContent({
        baseUrl,
        deployKey,
        files: { ...await readTestAppContent(), ...extraFiles },
        pluginContentRoots: PLUGIN_CONTENT_ROOTS,
        templateHelpers,
    });
}

/**
 * Publishes the test app's content once for the run. Every test file is
 * imported into one process, so they share the one publish through this
 * module, and none depends on another having run first.
 *
 * It only makes sure the build has been staged and serves the skeleton's
 * pages. A test that needs a particular Release assigned publishes it.
 *
 * @returns {Promise<{ releaseId: string, buildId: string, assignmentId: string, intent: string, uploaded: number }>}
 */
export function ensurePublished() {
    published ??= publishTestAppContent();

    return published;
}


/**
 * Compiles content files and publishes them to the build the target runs:
 * negotiates the protocol, uploads the objects the store lacks, creates the
 * Release, and assigns it. The first assignment to a build pre-stages it
 * with code; later ones are content-only publishes.
 *
 * @param {Object} options
 * @param {string} options.baseUrl - The target's origin, for example http://127.0.0.1:2026
 * @param {string|null} options.deployKey - Sent as a bearer token. Null sends none, which only an open development server accepts.
 * @param {Object<string, Uint8Array|string>} options.files - Content files by their path from the project root
 * @param {Array<Object>} [options.pluginContentRoots] - The `contentRoots` export of the project's registry
 * @param {string[]} [options.templateHelpers] - The `templateHelpers` export of the project's registry
 * @param {string} [options.sourceRevision] - The commit the content comes from
 * @param {string} [options.codeFingerprint] - The code fingerprint of that commit, used when the build is first staged
 * @param {Function} [options.fetch] - Defaults to the global fetch
 * @returns {Promise<{ releaseId: string, buildId: string, assignmentId: string, intent: string, uploaded: number }>}
 * @throws {Error} When the content has problems, the target speaks another protocol, or a request is refused
 */
export async function publishContent(options) {
    const {
        baseUrl,
        deployKey,
        files,
        pluginContentRoots = [],
        templateHelpers = [],
        sourceRevision = DEFAULT_SOURCE_REVISION,
        codeFingerprint = DEFAULT_CODE_FINGERPRINT,
        fetch: sendRequest = globalThis.fetch,
    } = options;

    const api = createApiClient({ baseUrl, deployKey, sendRequest });

    const compilation = await compileContent({
        source: createMemoryContentSource(files),
        pluginContentRoots,
        templateHelpers,
    });

    if (!compilation.release) {
        const problems = compilation.report.problems.map(({ code, filepath }) => `${ code } ${ filepath }`);
        throw new Error(`The content didn't compile into a Release: ${ problems.join('; ') }`);
    }

    // 1. Discovery, before any write: stop unless every version is one this
    // client speaks.
    const discovery = (await api.request('GET', '/')).data.attributes;

    if (
        discovery.buildAssignmentProtocolVersion !== PROTOCOL_VERSION
        || discovery.contentContractVersion !== CONTENT_CONTRACT_VERSION
        || discovery.addressingFormat !== ADDRESSING_FORMAT
    ) {
        throw new Error(
            'The target speaks another Publishing API protocol: '
            + `protocol ${ discovery.buildAssignmentProtocolVersion }, `
            + `contract ${ discovery.contentContractVersion }, `
            + `addressing ${ discovery.addressingFormat }.`,
        );
    }

    const buildId = discovery.runningBuildId;

    if (typeof buildId !== 'string' || buildId === '') {
        throw new Error('The target runs with no build id, so there is no build to publish to.');
    }

    // 2. Upload the objects the store lacks.
    const stored = new Set();
    const hashes = [ ...new Set(compilation.objects.map(({ hash }) => hash)) ];

    for (let index = 0; index < hashes.length; index += discovery.limits.maxObjectStatusIds) {
        const objectIds = hashes.slice(index, index + discovery.limits.maxObjectStatusIds);
        const status = await api.request('POST', '/objects/status', resource('ObjectStatus', { objectIds }));

        for (const { id } of status.data) {
            stored.add(id);
        }
    }

    let uploaded = 0;

    for (const object of compilation.objects) {
        if (!stored.has(object.hash)) {
            await api.putObject(object.hash, toBytes(serializeContentObject(object)));
            stored.add(object.hash);
            uploaded += 1;
        }
    }

    // 3. Create the Release. It is assigned to no build yet.
    const release = await api.request('POST', '/releases', resource('Release', {
        manifest: compilation.release.manifest,
        provenance: { sourceRevision, intendedForBuildId: buildId },
    }));

    const releaseId = release.data.id;

    // 4. Assign it to the running build. A build never assigned is
    // pre-staged with its code; after that, content-only publishes must name
    // the fingerprint the build was staged with.
    const current = await api.request('GET', `/builds/${ encodeURIComponent(buildId) }`, undefined, [ 404 ]);

    const attributes = current === null
        ? {
            intent: 'prestage',
            releaseId,
            expectedAssignmentId: null,
            sourceRevision,
            code: { revision: sourceRevision, fingerprint: codeFingerprint },
        }
        : {
            intent: 'publish',
            releaseId,
            expectedAssignmentId: current.data.attributes.assignmentId,
            sourceRevision,
            codeFingerprint: current.data.attributes.code?.fingerprint ?? codeFingerprint,
        };

    const build = await api.request(
        'PUT',
        `/builds/${ encodeURIComponent(buildId) }`,
        resource('Build', attributes, buildId),
    );

    return {
        releaseId,
        buildId,
        assignmentId: build.data.attributes.assignmentId,
        intent: attributes.intent,
        uploaded,
    };
}

// An object is stored as text or as bytes.
function toBytes(value) {
    return typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
}

function resource(type, attributes, id) {
    return { data: { type, ...(id === undefined ? {} : { id }), attributes } };
}

function createApiClient({ baseUrl, deployKey, sendRequest }) {
    const root = `${ baseUrl.replace(/\/$/, '') }/publishing-api/v1`;
    const authorization = deployKey ? { authorization: `Bearer ${ deployKey }` } : {};

    // Resolves the response document, or null for a status the caller
    // allows. The error names the request and the server's error codes,
    // never a header.
    async function send(method, pathname, init, allowedStatuses = []) {
        const response = await sendRequest(`${ root }${ pathname }`, {
            method,
            ...init,
            headers: { ...authorization, ...init.headers },
        });

        if (allowedStatuses.includes(response.status)) {
            await response.arrayBuffer();
            return null;
        }

        const text = await response.text();

        if (!response.ok) {
            throw new Error(`${ method } ${ pathname } answered ${ response.status }: ${ describeErrors(text) }`);
        }

        return JSON.parse(text);
    }

    return {
        request(method, pathname, document, allowedStatuses) {
            if (document === undefined) {
                return send(method, pathname, { headers: {} }, allowedStatuses);
            }

            return send(method, pathname, {
                headers: { 'content-type': JSON_API },
                body: JSON.stringify(document),
            }, allowedStatuses);
        },

        // Raw bytes, with no envelope. The server refuses an upload without
        // a Content-Length; fetch() sends one for a byte array.
        putObject(objectId, bytes) {
            return send('PUT', `/objects/${ objectId }`, {
                headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.byteLength) },
                body: bytes,
            });
        },
    };
}

function describeErrors(text) {
    try {
        const { errors } = JSON.parse(text);
        return errors.map(({ code, detail, source }) => [ code, detail, source ].filter(Boolean).join(' ')).join('; ');
    } catch {
        return 'no error document';
    }
}

async function readContent() {
    const files = {};

    await readDirectories(files, SKELETON_DIRECTORY, listContentDirectories([]), '');

    // In the built test app the plugin is at plugins/integration-probe/.
    await readDirectories(files, PLUGIN_DIRECTORY, [ 'pages' ], 'plugins/integration-probe/');

    return files;
}

async function readDirectories(files, root, directories, prefix) {
    const source = createFileSystemContentSource(root);

    for (const directory of directories) {
        const { entries } = await source.listFiles(directory);

        for (const entry of entries) {
            const filepath = `${ directory }/${ entry.path }`;
            files[`${ prefix }${ filepath }`] = new Uint8Array(await source.readFile(filepath));
        }
    }
}
