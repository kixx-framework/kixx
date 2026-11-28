/**
 * Pieces shared by the `kixx-dev local` commands.
 * @module local/command-support
 */

import path from 'node:path';
import process from 'node:process';
import { findProcessEnvCollisions } from './instance-store.js';
import { wrapText } from '../text-wrap.js';

export const TARGET_OPTION = Object.freeze({
    type: 'string',
    short: 't',
    description: 'Directory holding instances/; default <project>/.kixx',
});

export const NAME_POSITIONAL = Object.freeze({
    name: 'name',
    description: 'Instance name: lowercase letters, digits, single hyphens',
});


/**
 * @param {Object} output - Writable stream
 * @returns {function(string): void} Writes one wrapped `[kixx-dev local] ` line
 */
export function createLocalLog(output) {
    return (message) => {
        output.write(`${ wrapText(`[kixx-dev local] ${ message }`) }\n`);
    };
}

/**
 * Builds a follow-up command that targets the same instance from the
 * current working directory.
 * @param {Object} args
 * @param {string} args.command - Such as "start alpha"
 * @param {string} args.projectDirectory - Project directory
 * @param {string} [args.target] - The --target value as given
 * @param {string} [args.cwd] - Defaults to `process.cwd()`
 * @returns {string} Such as "kixx-dev local start alpha lib --target tmp/x"
 */
export function formatLocalCommand(args) {
    const { command, projectDirectory, target, cwd = process.cwd() } = args ?? {};

    let text = `kixx-dev local ${ command }`;

    const directory = path.relative(cwd, projectDirectory);

    if (directory !== '') {
        text += ` ${ directory }`;
    }

    // A value that starts with a dash is only read as one in the `=` form.
    if (target !== undefined) {
        text += target.startsWith('-') ? ` --target=${ target }` : ` --target ${ target }`;
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

/**
 * @param {{env: Object<string, string>, secrets: Object<string, string>}} instance - From `readInstance()`
 * @returns {string[]} Names defined in the instance's `.env` and `.env.secrets`
 */
export function listEnvNames(instance) {
    return [ ...Object.keys(instance.env), ...Object.keys(instance.secrets) ];
}
