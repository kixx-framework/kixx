import { spawn } from 'node:child_process';
import {
    AssertionError,
    assertNonEmptyString,
    isNumber,
    isNonEmptyString,
} from 'kixx-assert';

/**
 * Validates a full HTML document with the Nu Html Checker (`vnu`) CLI.
 *
 * Spawns `vnu --format json --stdout -`, streams the document to the child
 * process stdin, and inspects the JSON report. Only error-level messages fail
 * validation; vnu warnings and info messages are ignored. The helper validates
 * whatever string it receives, so callers must pass complete HTML documents —
 * Hyperview fragments and JSON responses produce spurious errors.
 *
 * `vnu` is a required dependency of the integration test suite. When the `vnu`
 * command is not found on the PATH the returned promise rejects with installation
 * guidance rather than skipping validation. See the "HTML Validation (vnu)"
 * section of the README.
 */

const VNU_COMMAND = 'vnu';
const VNU_ARGS = [ '--format', 'json', '--stdout', '-' ];

const INSTALL_HELP = 'The vnu HTML validator is required to run the integration tests, '
    + 'but the "vnu" command was not found on your PATH. See the "HTML Validation (vnu)" '
    + 'section of the README for installation instructions.';

/**
 * Validates an HTML document string and resolves when it contains no errors.
 * @param {string} html - A complete HTML document to validate.
 * @returns {Promise<void>} Resolves when vnu reports no error-level messages.
 * @throws {AssertionError} When `html` is not a non-empty string.
 * @throws {AssertionError} When the `vnu` command is not installed.
 * @throws {AssertionError} When vnu reports one or more error-level messages.
 * @throws {AssertionError} When vnu exits non-zero without a parseable report.
 */
export default function validateHtml(html) {
    assertNonEmptyString(html, 'validateHtml() requires a non-empty HTML document string');

    return new Promise((resolve, reject) => {
        const child = spawn(VNU_COMMAND, VNU_ARGS);

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        const stdoutChunks = [];
        const stderrChunks = [];
        let spawnFailed = false;

        child.on('error', (cause) => {
            spawnFailed = true;
            if (cause.code === 'ENOENT') {
                reject(new AssertionError(INSTALL_HELP, { cause }, validateHtml));
                return;
            }
            reject(new AssertionError(`Failed to run the vnu HTML validator: ${ cause.message }`, { cause }, validateHtml));
        });

        child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
        child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

        child.on('close', (code) => {
            // The 'error' handler already rejected when the process failed to spawn.
            if (spawnFailed) {
                return;
            }

            const stdout = stdoutChunks.join('');
            const stderr = stderrChunks.join('');

            if (code === 0) {
                resolve();
                return;
            }

            // vnu exits non-zero when it finds errors and writes a JSON report to
            // stdout. Anything else (no output, unparseable output, a non-zero exit
            // with only warnings) is an unexpected vnu failure worth surfacing raw.
            let report;
            try {
                report = JSON.parse(stdout);
            } catch {
                reject(new AssertionError(formatUnexpectedFailure(code, stdout, stderr), null, validateHtml));
                return;
            }

            const messages = Array.isArray(report.messages) ? report.messages : [];
            const errors = messages.filter((message) => message.type === 'error');

            if (errors.length === 0) {
                reject(new AssertionError(formatUnexpectedFailure(code, stdout, stderr), null, validateHtml));
                return;
            }

            reject(new AssertionError(formatValidationErrors(errors), null, validateHtml));
        });

        // Ignore stdin errors (e.g. EPIPE if vnu exits early); the 'error' and
        // 'close' handlers are responsible for reporting the outcome.
        child.stdin.on('error', () => {});
        child.stdin.end(html);
    });
}

/**
 * Builds a single-line location label from a vnu message. vnu always reports
 * `lastLine`/`lastColumn` and usually `firstColumn`, but only includes
 * `firstLine` for multi-line spans.
 * @param {Object} message - A vnu message object.
 * @returns {string} A human-readable location label.
 */
function formatLocation(message) {
    const {
        firstLine,
        lastLine,
        firstColumn,
        lastColumn,
    } = message;

    if (isNumber(firstLine) && firstLine !== lastLine) {
        return `lines ${ firstLine }:${ firstColumn }–${ lastLine }:${ lastColumn }`;
    }

    if (isNumber(firstColumn) && firstColumn !== lastColumn) {
        return `line ${ lastLine }, columns ${ firstColumn }–${ lastColumn }`;
    }

    return `line ${ lastLine }, column ${ lastColumn }`;
}

/**
 * Collapses a vnu `extract` to a single trimmed line so it reads cleanly in
 * assertion output. vnu extracts often span the line break around the error.
 * @param {string} extract - The `extract` field from a vnu message.
 * @returns {string} The extract with internal whitespace collapsed.
 */
function formatExtract(extract) {
    return extract.replace(/\s+/g, ' ').trim();
}

/**
 * Formats vnu error messages into a single assertion message listing each
 * error with its location, description, and source extract.
 * @param {Object[]} errors - Error-level vnu messages.
 * @returns {string} The assembled assertion message.
 */
function formatValidationErrors(errors) {
    const lines = [ `The vnu HTML validator reported ${ errors.length } error(s):` ];

    errors.forEach((message, index) => {
        lines.push('');
        lines.push(`  ${ index + 1 }. ${ formatLocation(message) }`);
        lines.push(`     ${ message.message }`);
        if (isNonEmptyString(message.extract)) {
            lines.push(`     extract: ${ formatExtract(message.extract) }`);
        }
    });

    return lines.join('\n');
}

/**
 * Formats a message for a non-zero vnu exit that produced no parseable error
 * report, preserving raw output so the unexpected failure is debuggable.
 * @param {number|null} code - The vnu process exit code.
 * @param {string} stdout - Captured standard output.
 * @param {string} stderr - Captured standard error.
 * @returns {string} The assembled assertion message.
 */
function formatUnexpectedFailure(code, stdout, stderr) {
    const detail = isNonEmptyString(stderr.trim()) ? stderr.trim() : stdout.trim();
    const base = `The vnu HTML validator exited with code ${ code } but produced no parseable error report.`;
    return isNonEmptyString(detail) ? `${ base }\nOutput:\n${ detail }` : base;
}
