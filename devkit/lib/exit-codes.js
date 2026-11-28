/**
 * The one exit-code table of the CLI, and the mapping from a thrown error to
 * a row of it. Each number means one thing for every command.
 *
 * WARNING: also update the table in `commands/README.md`. A test compares the
 * two.
 * @module exit-codes
 */

import UsageError from './usage-error.js';
import { isNonEmptyString, isObjectNotNull } from './vendor/kixx-assert/mod.js';


/**
 * @typedef {Object} ExitCodeRow
 * @property {number} code - Process exit code; always below 126, where shells start
 * @property {string} name - Stable name; also the `error.code` of the envelope
 * @property {string} meaning - One sentence for the docs and for help
 */

/**
 * Codes 10 and up are named refusals that later commands add here.
 * @type {ReadonlyArray<ExitCodeRow>}
 */
export const EXIT_CODES = Object.freeze([
    { code: 0, name: 'Success', meaning: 'The command finished.' },
    { code: 1, name: 'UnexpectedError', meaning: 'An unexpected error: a defect, printed with its stack.' },
    { code: 2, name: 'UsageError', meaning: 'A mistake the user can fix. The message is printed with no stack.' },
    { code: 3, name: 'ProjectNotFound', meaning: 'The command needs a Kixx project and was not run inside one.' },
    { code: 3, name: 'UnsupportedProjectVersion', meaning: 'This kixx-dev does not support the project\'s Kixx version.' },
    { code: 4, name: 'CommandNotAvailable', meaning: 'The command is not available in this version of kixx-dev.' },
].map((row) => Object.freeze(row)));

const SUCCESS = 'Success';
const UNEXPECTED_ERROR = 'UnexpectedError';
const USAGE_ERROR = 'UsageError';

/**
 * Error code to exit code, for every row an error can carry.
 * @type {Readonly<Object<string, number>>}
 */
export const EXIT_CODE_BY_ERROR_CODE = Object.freeze(Object.fromEntries(
    EXIT_CODES
        .filter(({ name }) => name !== SUCCESS)
        .map(({ name, code }) => [ name, code ]),
));

// Errors thrown by a project's own Kixx code that describe a problem the
// developer can fix. They are matched by name because the class comes from the
// project's copy of core, so `instanceof` against any devkit class is false.
const PROJECT_ERROR_NAMES = Object.freeze([ 'ValidationError', 'OperationalError' ]);


/**
 * @typedef {Object} ErrorReport
 * @property {string} code - Stable name of the failure
 * @property {number} exitCode
 * @property {string} message
 * @property {Array<{message: string, source: *}>} [problems] - The entries of a
 *   project ValidationError's `errors` array
 */

/**
 * Maps a thrown value to the `error` object of the `--json` envelope.
 * @param {*} error - Whatever was thrown
 * @returns {ErrorReport}
 */
export function describeError(error) {
    const message = isObjectNotNull(error) && isNonEmptyString(error.message) ? error.message : String(error);
    const code = isObjectNotNull(error) ? error.code : undefined;
    const name = isObjectNotNull(error) ? error.name : undefined;

    if (isNonEmptyString(code) && Object.hasOwn(EXIT_CODE_BY_ERROR_CODE, code)) {
        return { code, exitCode: EXIT_CODE_BY_ERROR_CODE[code], message };
    }

    // UsageError is a devkit class, so instanceof is safe here and also
    // matches subclasses, which keep their own code.
    if (error instanceof UsageError) {
        return { code: isNonEmptyString(code) ? code : USAGE_ERROR, exitCode: EXIT_CODE_BY_ERROR_CODE[USAGE_ERROR], message };
    }

    if (PROJECT_ERROR_NAMES.includes(name)) {
        const report = { code: name, exitCode: EXIT_CODE_BY_ERROR_CODE[USAGE_ERROR], message };

        if (name === 'ValidationError' && Array.isArray(error.errors)) {
            report.problems = error.errors.map((problem) => ({
                message: String(problem?.message ?? ''),
                source: problem?.source ?? null,
            }));
        }

        return report;
    }

    return { code: UNEXPECTED_ERROR, exitCode: EXIT_CODE_BY_ERROR_CODE[UNEXPECTED_ERROR], message };
}

/**
 * @param {*} error - Whatever was thrown
 * @returns {number} The process exit code for the error
 */
export function getExitCodeForError(error) {
    return describeError(error).exitCode;
}
