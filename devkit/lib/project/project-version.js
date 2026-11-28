/**
 * The project version gate. It runs before any project code is loaded, so it
 * reads `kixx/plugin.json` as data and holds its own version comparison.
 *
 * The rule is the one core uses for a plugin's `core` field: the same major
 * version, and at least the oldest supported version, with a prerelease tag
 * ignored.
 * @module project-version
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import UsageError from '../usage-error.js';
import { isNonEmptyString, isPlainObject } from '../vendor/kixx-assert/mod.js';
import { CORE_MANIFEST_SEGMENTS } from './find-project.js';


/**
 * The oldest project (core) version this CLI works with.
 * @type {string}
 */
export const OLDEST_SUPPORTED_PROJECT_VERSION = '7.0.0';

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;


/**
 * Thrown when this CLI can't work with the project's copy of Kixx. Exits 3.
 */
export class UnsupportedProjectVersionError extends UsageError {
    static code = 'UnsupportedProjectVersion';
}

/**
 * Reads the version from a project's core manifest.
 * @param {string} projectDirectory - Absolute path of the project
 * @returns {Promise<string>} The version, such as `7.0.0-alpha.0`
 * @throws {UnsupportedProjectVersionError} When the manifest can't be read, is not JSON, or has no valid version
 */
export async function readProjectVersion(projectDirectory) {
    const filepath = path.join(projectDirectory, ...CORE_MANIFEST_SEGMENTS);

    let manifest;

    try {
        manifest = JSON.parse(await fsp.readFile(filepath, 'utf8'));
    } catch (cause) {
        const reason = cause instanceof SyntaxError ? 'it is not valid JSON' : cause.message;

        throw new UnsupportedProjectVersionError(
            `Unable to read the project's Kixx version from ${ filepath }: ${ reason }.`,
            { cause },
        );
    }

    const version = isPlainObject(manifest) ? manifest.version : undefined;

    if (!isNonEmptyString(version) || !VERSION_PATTERN.test(version)) {
        throw new UnsupportedProjectVersionError(
            `Unable to read the project's Kixx version from ${ filepath }: `
            + 'it has no "version" like 7.0.0. Restore the project\'s kixx/ directory.',
        );
    }

    return version;
}

/**
 * Decides whether this CLI supports a project version.
 * @param {Object} args
 * @param {string} args.projectVersion - From the project's `kixx/plugin.json`
 * @param {string} args.cliVersion - This CLI's version
 * @param {string} [args.oldestSupportedVersion] - Defaults to `OLDEST_SUPPORTED_PROJECT_VERSION`
 * @returns {{isNewerThanCli: boolean}} `isNewerThanCli` is true for a supported project newer than this CLI
 * @throws {UnsupportedProjectVersionError} When the major version differs, or the project is older than the oldest supported version
 */
export function checkProjectVersion(args) {
    const {
        projectVersion,
        cliVersion,
        oldestSupportedVersion = OLDEST_SUPPORTED_PROJECT_VERSION,
    } = args ?? {};

    const project = parseVersion(projectVersion);
    const oldest = parseVersion(oldestSupportedVersion);

    const [ projectMajor ] = project;
    const [ supportedMajor ] = oldest;

    const summary = `The project uses Kixx ${ projectVersion }, which kixx-dev ${ cliVersion } does not support `
        + `(it supports ${ oldestSupportedVersion } and later ${ supportedMajor }.x versions).`;

    if (projectMajor > supportedMajor) {
        throw new UnsupportedProjectVersionError(`${ summary } Upgrade kixx-dev to version ${ projectMajor }.`);
    }

    if (projectMajor < supportedMajor) {
        throw new UnsupportedProjectVersionError(
            `${ summary } Install kixx-dev version ${ projectMajor }, or upgrade the project's Kixx.`,
        );
    }

    if (compareVersions(project, oldest) < 0) {
        throw new UnsupportedProjectVersionError(
            `${ summary } Upgrade the project's Kixx, or install an older kixx-dev.`,
        );
    }

    return { isNewerThanCli: compareVersions(project, parseVersion(cliVersion)) > 0 };
}

// The prerelease tag is dropped: 7.0.0-alpha.0 counts as 7.0.0.
function parseVersion(version) {
    return version.split('-')[0].split('.').map((part) => Number.parseInt(part, 10));
}

function compareVersions(a, b) {
    for (let index = 0; index < 3; index += 1) {
        if (a[index] !== b[index]) {
            return a[index] - b[index];
        }
    }

    return 0;
}
