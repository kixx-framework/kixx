/**
 * Stand-ins for the two parsers the devkit takes from a project's tooling.
 * They read only what the tests in this suite write, and are not the
 * grammar: `test/conformance/project-tooling.test.js` runs the devkit with
 * core's real parsers.
 */

const DIRECTIVES = Object.freeze({
    '# @optional': 'optional',
    '# @required-outside-development': 'requiredOutsideDevelopment',
});

/**
 * Stands in for core's `parseSecretsManifest()`: `NAME=value` lines, comments,
 * and the two directives, each marking the next entry.
 * @param {string} text
 * @returns {{required: string[], optional: string[], requiredOutsideDevelopment: string[]}}
 * @throws {Error} Named `OperationalError`, as core's is, for a line with no `=`
 */
export function parseSecretsManifest(text) {
    const manifest = { required: [], optional: [], requiredOutsideDevelopment: [] };
    let list = 'required';

    for (const [ index, raw ] of text.split('\n').entries()) {
        const line = raw.trim();

        if (Object.hasOwn(DIRECTIVES, line)) {
            list = DIRECTIVES[line];
        } else if (line !== '' && !line.startsWith('#')) {
            if (!line.includes('=')) {
                // Core quotes the line in this message.
                throw makeOperationalError(`Invalid secrets manifest on line ${ index + 1 }: expected NAME=value: "${ line }"`);
            }

            manifest[list].push(line.slice(0, line.indexOf('=')));
            list = 'required';
        }
    }

    for (const names of Object.values(manifest)) {
        names.sort();
    }

    return manifest;
}

/**
 * Stands in for core's `parseJsonc()`: whole-line `//` comments, a comma
 * before a closing bracket, and JSON.
 * @param {string} source
 * @returns {*}
 * @throws {Error} Named `OperationalError` when what is left is not JSON
 */
export function parseJsonc(source) {
    const json = source
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')
        .replace(/,(\s*[}\]])/g, '$1');

    try {
        return JSON.parse(json);
    } catch (cause) {
        throw makeOperationalError(`Invalid JSONC: ${ cause.message }`);
    }
}

function makeOperationalError(message) {
    const error = new Error(message);
    error.name = 'OperationalError';
    return error;
}
