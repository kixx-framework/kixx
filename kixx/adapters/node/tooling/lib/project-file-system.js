import fsp from 'node:fs/promises';
import path from 'node:path';
import { assertNonEmptyString } from '../../../../assertions/mod.js';
import { OperationalError } from '../../../../errors/mod.js';


/**
 * @typedef {import('../../../../tooling/project-file-system-interface.js').ProjectFileSystemInterface} ProjectFileSystemInterface
 */


/**
 * Creates the file access the registry generator needs, over the Node.js file
 * system. Every path a method takes is resolved against the project
 * directory, and may begin with `../` to reach a core outside it.
 *
 * @param {string} projectDirectory - The project root; a relative path is resolved against the working directory
 * @returns {ProjectFileSystemInterface}
 */
export function createProjectFileSystem(projectDirectory) {
    assertNonEmptyString(projectDirectory, 'createProjectFileSystem: projectDirectory');

    const rootDirectory = path.resolve(projectDirectory);
    const resolve = (relativePath) => path.resolve(rootDirectory, relativePath);

    return {
        async readTextFile(relativePath) {
            const filepath = resolve(relativePath);

            try {
                return await fsp.readFile(filepath, 'utf8');
            } catch (cause) {
                if (cause.code === 'ENOENT') {
                    return null;
                }

                throw new OperationalError(`Unable to read file ${ filepath } (${ cause.code })`, { cause });
            }
        },

        async listDirectories(relativePath) {
            const directory = resolve(relativePath);
            let entries;

            try {
                entries = await fsp.readdir(directory, { withFileTypes: true });
            } catch (cause) {
                if (cause.code === 'ENOENT') {
                    return [];
                }

                throw new OperationalError(`Unable to read directory ${ directory } (${ cause.code })`, { cause });
            }

            // Sorted by code unit, so the listing is the same on every machine.
            return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
        },

        async writeTextFile(relativePath, text) {
            const filepath = resolve(relativePath);

            try {
                await fsp.writeFile(filepath, text, 'utf8');
            } catch (cause) {
                throw new OperationalError(`Unable to write file ${ filepath } (${ cause.code })`, { cause });
            }
        },
    };
}
