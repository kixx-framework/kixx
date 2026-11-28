// Builds a real project for the conformance tests and the entry point test:
// the skeleton, with this repository's core as its kixx/. It is what
// tools/lib/assemble-project.js builds, without the generated files, which
// the tests write with `kixx-dev generate`.
//
// This helper lives in test/conformance/ because it reads core, which no
// other devkit code may do.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


const SKELETON_DIRECTORY = fileURLToPath(new URL('../../templates/project/', import.meta.url));
const CORE_DIRECTORY = fileURLToPath(new URL('../../../kixx/', import.meta.url));

/**
 * The files `kixx-dev generate` writes, in the order the generator names them.
 * @type {ReadonlyArray<string>}
 */
export const GENERATED_FILE_NAMES = Object.freeze([
    'node-registry.generated.js',
    'cloudflare-registry.generated.js',
    'cloudflare-durable-objects.generated.js',
    'routes.generated.js',
    'example.env.secrets',
]);

/**
 * Builds a project with no plugins and no generated files in a new
 * temporary directory. The caller removes it with `removeProject()`.
 *
 * @returns {Promise<string>} The project directory, as a real path
 */
export async function buildProject() {
    const directory = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-dev-project-')));

    await fsp.cp(SKELETON_DIRECTORY, directory, { recursive: true });
    await fsp.rename(path.join(directory, 'gitignore'), path.join(directory, '.gitignore'));
    await fsp.cp(CORE_DIRECTORY, path.join(directory, 'kixx'), { recursive: true });

    return directory;
}

/**
 * @param {string} [directory] - What `buildProject()` resolved; nothing happens without it
 * @returns {Promise<void>}
 */
export async function removeProject(directory) {
    if (directory) {
        await fsp.rm(directory, { recursive: true, force: true });
    }
}

/**
 * Reads the generated files a project holds.
 *
 * @param {string} directory - The project directory
 * @returns {Promise<Map<string, string>>} File text by name, for each generated file that exists
 */
export async function readGeneratedFiles(directory) {
    const files = new Map();

    for (const fileName of GENERATED_FILE_NAMES) {
        try {
            files.set(fileName, await fsp.readFile(path.join(directory, fileName), 'utf8'));
        } catch (cause) {
            if (cause.code !== 'ENOENT') {
                throw cause;
            }
        }
    }

    return files;
}
