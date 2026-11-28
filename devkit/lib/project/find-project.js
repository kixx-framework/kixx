/**
 * Project discovery. A Kixx project is the nearest directory, at or above
 * the start directory, that holds `kixx/plugin.json`: core's manifest, which
 * every project commits. The untracked `.kixx/` settings directory can't mark
 * a project, because a fresh clone has none.
 * @module find-project
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import UsageError from '../usage-error.js';


/**
 * Core's manifest, as path segments from the project root.
 * @type {ReadonlyArray<string>}
 */
export const CORE_MANIFEST_SEGMENTS = Object.freeze([ 'kixx', 'plugin.json' ]);

/**
 * Thrown when a command needs a project and was not run inside one. Exits 3.
 */
export class ProjectNotFoundError extends UsageError {
    static code = 'ProjectNotFound';
}

/**
 * Walks up from the start directory to the file-system root.
 * @param {string} startDirectory - Where to begin; resolved to an absolute path
 * @returns {Promise<string|null>} The nearest project directory, or null
 */
export async function findProject(startDirectory) {
    let currentDirectory = path.resolve(startDirectory);

    for (;;) {
        // eslint-disable-next-line no-await-in-loop
        if (await isFile(path.join(currentDirectory, ...CORE_MANIFEST_SEGMENTS))) {
            return currentDirectory;
        }

        const parentDirectory = path.dirname(currentDirectory);

        if (parentDirectory === currentDirectory) {
            return null;
        }

        currentDirectory = parentDirectory;
    }
}

/**
 * Finds the project a command runs in.
 * @param {string} startDirectory - Where to begin
 * @returns {Promise<string>} The project directory
 * @throws {ProjectNotFoundError} When no directory at or above the start holds `kixx/plugin.json`
 */
export async function requireProject(startDirectory) {
    const projectDirectory = await findProject(startDirectory);

    if (projectDirectory === null) {
        throw new ProjectNotFoundError(
            `${ path.resolve(startDirectory) } is not inside a Kixx project: no directory at or above it holds `
            + `${ CORE_MANIFEST_SEGMENTS.join('/') }. Run this command inside a project, or pass the project's directory.`,
        );
    }

    return projectDirectory;
}

async function isFile(filepath) {
    try {
        const stats = await fsp.stat(filepath);
        return stats.isFile();
    } catch {
        return false;
    }
}
