/**
 * Reads a value from the operator's terminal, or from an environment
 * variable when one is set.
 * @module prompt
 */

import readline from 'node:readline';
import process from 'node:process';
import { isNonEmptyString, isUndefined } from './vendor/kixx-assert/mod.js';

import UsageError from './usage-error.js';

/**
 * Resolves one value from an environment variable, or by prompting the
 * operator's terminal when the variable is absent.
 *
 * A non-empty environment variable is returned without touching the input
 * stream. Otherwise the input stream must be a TTY; a non-interactive stream
 * fails immediately rather than blocking, naming the variable to set instead.
 * @param {Object} args - Prompt configuration
 * @param {string} args.envVar - Environment variable that bypasses the prompt
 * @param {string} args.label - Operator-facing prompt label, such as "Admin password"
 * @param {boolean} [args.mask=false] - Suppress echo of the typed value
 * @param {NodeJS.ReadableStream} [args.input=process.stdin] - Input stream to read from
 * @param {NodeJS.WritableStream} [args.output=process.stdout] - Output stream for the prompt and echo
 * @param {Object<string, string>} [args.env=process.env] - Environment variables
 * @returns {Promise<string>} The resolved value, trimmed when read from the terminal
 * @throws {UsageError} When the variable is absent and the input stream is not a TTY, or the prompt is cancelled
 */
export async function promptForValue(args) {
    const {
        envVar,
        label,
        mask = false,
        input = process.stdin,
        output = process.stdout,
        env = process.env,
    } = args ?? {};

    const envValue = readEnvironmentValue(env, envVar);
    if (!isUndefined(envValue)) {
        return envValue;
    }

    if (!input.isTTY) {
        throw new UsageError(
            `${ label } is required. Set the ${ envVar } environment variable, or run this command from a terminal.`,
        );
    }

    return await readLineFromTerminal({ label, mask, input, output });
}

/**
 * Resolves one value by prompting twice and requiring both entries to match.
 *
 * Used for a new password, where a typo would otherwise create a credential
 * nobody can use. When the environment variable is set, it is returned
 * directly and the terminal is never touched.
 * @param {Object} args - Prompt configuration
 * @param {string} args.envVar - Environment variable that bypasses both prompts
 * @param {string} args.label - Operator-facing label for the first prompt
 * @param {string} [args.confirmLabel] - Label for the second prompt, defaults to "Confirm <label>"
 * @param {boolean} [args.mask=true] - Suppress echo of the typed value
 * @param {NodeJS.ReadableStream} [args.input=process.stdin] - Input stream to read from
 * @param {NodeJS.WritableStream} [args.output=process.stdout] - Output stream for the prompt and echo
 * @param {Object<string, string>} [args.env=process.env] - Environment variables
 * @returns {Promise<string>} The confirmed value
 * @throws {UsageError} When the two entries differ, or under the same conditions as {@link promptForValue}
 */
export async function promptForValueTwice(args) {
    const {
        envVar,
        label,
        confirmLabel = `Confirm ${ label }`,
        mask = true,
        input = process.stdin,
        output = process.stdout,
        env = process.env,
    } = args ?? {};

    const envValue = readEnvironmentValue(env, envVar);
    if (!isUndefined(envValue)) {
        return envValue;
    }

    const first = await promptForValue({ envVar, label, mask, input, output, env });
    const second = await promptForValue({ envVar, label: confirmLabel, mask, input, output, env });

    if (first !== second) {
        throw new UsageError(`${ label } entries did not match.`);
    }

    return first;
}

function readEnvironmentValue(env, envVar) {
    const value = env?.[envVar];

    if (isNonEmptyString(value) && value.trim().length > 0) {
        return value;
    }

    return undefined;
}

function readLineFromTerminal(args) {
    const { label, mask, input, output } = args;

    return new Promise((resolve, reject) => {
        const rl = readline.createInterface({ input, output, terminal: true });

        if (mask) {
            // readline has no public option for a silent prompt. Overriding
            // this internal hook is the standard workaround for suppressing
            // per-keystroke echo without hand-rolling raw mode handling.
            rl._writeToOutput = () => {};
        }

        output.write(`${ label }: `);

        rl.on('line', (line) => {
            if (mask) {
                output.write('\n');
            }
            // Resolve before closing: closing emits 'close', and the promise
            // must already be settled so that handler's rejection is a no-op.
            resolve(line.trim());
            rl.close();
        });

        // Fires on EOF (Ctrl-D) and Ctrl-C, and after our own rl.close()
        // above, where the promise is already settled.
        rl.on('close', () => {
            reject(new UsageError(`${ label } was not provided.`));
        });
    });
}
