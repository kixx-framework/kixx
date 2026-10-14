import path from 'node:path';
import { sha256Hex } from '../canonical-hash.js';
import defaultBundleModules from '../bundler/bundle-modules.js';
import defaultFileSystem from '../file-system.js';

const TEXT_ENCODER = new TextEncoder();

/**
 * Worker entry module, relative to the project root.
 * @type {string}
 */
export const WORKER_ENTRY_FILE_NAME = 'cloudflare-server.js';

// Provided by the Workers runtime, so never packaged.
const WORKER_EXTERNALS = [ 'node:', 'cloudflare:' ];

/**
 * Turns a bundler result into the module list Cloudflare accepts, with
 * wrangler-style names, and a stable digest over that list. Owns the `./`
 * prefix translation: the bundler's key namespace is unchanged, and this is
 * the adapter boundary where target-specific naming belongs.
 * @module worker-modules
 */

/**
 * @typedef {Object} WorkerModule
 * @property {string} name - Module name with no `./` prefix, such as `cloudflare-server.js`.
 * @property {string} content - Module source, verbatim.
 */

/**
 * @param {Object} bundle - Bundler result.
 * @param {string} bundle.entry - Entry module key, `./`-prefixed.
 * @param {Map<string, { name: string, source: string }>} bundle.modules - Bundled modules, keyed the same way, in bundler emit order.
 * @returns {{ mainModule: string, modules: WorkerModule[] }} `mainModule` is the entry with no `./` prefix; `modules` keeps the bundler's emit order, entry first.
 * @throws {Error} When a module key does not start with `./`, meaning the bundler's documented contract changed.
 */
export function toWorkerModules(bundle) {
    const { entry, modules } = bundle;

    const workerModules = Array.from(modules.values()).map((mod) => ({
        name: stripPrefix(mod.name),
        content: mod.source,
    }));

    return {
        mainModule: stripPrefix(entry),
        modules: workerModules,
    };
}

/**
 * Hashes a module list independent of order, so a module that merely moves
 * position in the import graph is not a change.
 * @param {WorkerModule[]} modules - Modules to hash.
 * @returns {string} 64-character lowercase hex digest.
 */
export function hashWorkerModules(modules) {
    const sorted = modules.slice().sort((a, b) => (a.name < b.name ? -1 : 1));

    // A length delimiter before each source prevents two module sets whose
    // names and sources concatenate identically from hashing the same.
    const text = sorted.map((mod) => {
        const byteLength = TEXT_ENCODER.encode(mod.content).length;
        return `${ mod.name }\n${ byteLength }\n${ mod.content }\n`;
    }).join('');

    return sha256Hex(text);
}

/**
 * Bundles the static import graph rooted at `<project>/cloudflare-server.js`
 * into Cloudflare modules and hashes them.
 * @param {Object} args - Options
 * @param {string} args.projectDirectory - Absolute project root
 * @param {import('../file-system.js').FileSystem} [args.fileSystem] - Filesystem adapter
 * @param {Function} [args.bundleModules] - Bundler, for tests
 * @returns {Promise<{ mainModule: string, modules: WorkerModule[], modulesHash: string }>} Packaged modules
 * @throws {import('../bundler/bundle-error.js').default} When any reachable module cannot be bundled
 */
export async function packageWorkerModules(args) {
    const {
        projectDirectory,
        fileSystem = defaultFileSystem,
        bundleModules = defaultBundleModules,
    } = args ?? {};

    const bundle = await bundleModules({
        entryFilepath: path.join(projectDirectory, WORKER_ENTRY_FILE_NAME),
        externals: WORKER_EXTERNALS,
        fileSystem,
    });

    const { mainModule, modules } = toWorkerModules(bundle);

    return { mainModule, modules, modulesHash: hashWorkerModules(modules) };
}

function stripPrefix(name) {
    if (!name.startsWith('./')) {
        throw new Error(`worker-modules: expected module key "${ name }" to start with "./"`);
    }

    return name.slice(2);
}
