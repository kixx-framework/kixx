/**
 * Pieces shared by the `kixx local` sub-commands.
 * @module local/command-support
 */

import path from 'node:path';
import process from 'node:process';
import { findProcessEnvCollisions } from './instance-store.js';
import { wrapText } from '../text-wrap.js';

export const TARGET_OPTION = Object.freeze({
    type: 'string',
    short: 't',
    description: 'Directory holding instances/; default <app>/.kixx',
});

export const NAME_POSITIONAL = Object.freeze({
    name: 'name',
    description: 'Instance name: lowercase letters, digits, single hyphens',
});


/**
 * @param {Object} output - Writable stream
 * @returns {function(string): void} Writes one wrapped `[kixx local] ` line
 */
export function createLocalLog(output) {
    return (message) => {
        output.write(`${ wrapText(`[kixx local] ${ message }`) }\n`);
    };
}

/**
 * Builds a follow-up command that targets the same instance from the
 * current working directory.
 * @param {Object} args
 * @param {string} args.command - Such as "seed alpha"
 * @param {string} args.projectDirectory - Application directory
 * @param {string} [args.target] - The --target value as given
 * @param {string} [args.cwd] - Defaults to `process.cwd()`
 * @returns {string} Such as "kixx local seed alpha lib --target tmp/x"
 */
export function formatLocalCommand(args) {
    const { command, projectDirectory, target, cwd = process.cwd() } = args ?? {};

    let text = `kixx local ${ command }`;

    const directory = path.relative(cwd, projectDirectory);

    if (directory !== '') {
        text += ` ${ directory }`;
    }

    if (target !== undefined) {
        text += ` --target ${ target }`;
    }

    return text;
}

/**
 * @param {string[]} names - Dotenv names of the instance
 * @param {Object<string, string>} env - Process environment
 * @returns {string|null} A warning, or null when nothing collides
 */
export function formatCollisionWarning(names, env) {
    const collisions = findProcessEnvCollisions(names, env);

    if (collisions.length === 0) {
        return null;
    }

    return `Warning: ${ collisions.join(', ') } ${ collisions.length === 1 ? 'is' : 'are' } set in ` +
        'this shell and in the instance dotenv files. The app server will refuse to start until ' +
        `${ collisions.length === 1 ? 'it is' : 'they are' } unset.`;
}
