import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../lib/vendor/kixx-assert/mod.js';
import { SECRETS_MANIFEST_FILE_NAME, readSecretsManifest } from '../../lib/read-secrets-manifest.js';
import createMemoryFileSystem from '../helpers/memory-file-system.js';
import { parseSecretsManifest } from '../helpers/fake-parsers.js';


const PROJECT_DIRECTORY = path.resolve('/work/project');
const FILEPATH = path.join(PROJECT_DIRECTORY, 'example.env.secrets');


function read(text, overrides) {
    return readSecretsManifest({
        projectDirectory: PROJECT_DIRECTORY,
        fileSystem: createMemoryFileSystem(text === null ? {} : { [FILEPATH]: text }),
        parseSecretsManifest,
        ...overrides,
    });
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }

    return null;
}


describe('readSecretsManifest()', ({ it }) => {

    it('names the file', () => {
        assertEqual('example.env.secrets', SECRETS_MANIFEST_FILE_NAME);
    });

    it('gives the file\'s text to the injected parser and resolves three sorted lists', async () => {
        const seen = [];

        const manifest = await read('anything', {
            parseSecretsManifest(text) {
                seen.push(text);

                // Unsorted, and frozen as project code may return it.
                return Object.freeze({
                    required: Object.freeze([ 'B', 'A' ]),
                    optional: Object.freeze([ 'D', 'C' ]),
                    requiredOutsideDevelopment: Object.freeze([ 'F', 'E' ]),
                });
            },
        });

        assertEqual('anything', seen.join('|'));
        assertEqual('required,optional,requiredOutsideDevelopment', Object.keys(manifest).join(','));
        assertEqual('A,B', manifest.required.join(','));
        assertEqual('C,D', manifest.optional.join(','));
        assertEqual('E,F', manifest.requiredOutsideDevelopment.join(','));
    });

    it('keeps the names required outside development in their own list', async () => {
        const manifest = await read('API_SECRET=\n# @required-outside-development\nDEPLOY_KEY_HASH=\n# @optional\nEXTRA=\n');

        assertEqual('API_SECRET', manifest.required.join(','));
        assertEqual('DEPLOY_KEY_HASH', manifest.requiredOutsideDevelopment.join(','));
        assertEqual('EXTRA', manifest.optional.join(','));
    });

    it('requires the parser', async () => {
        const error = await catchAsyncError(() => read('A=\n', { parseSecretsManifest: undefined }));

        assertEqual('AssertionError', error?.name);
        assertMatches('requires parseSecretsManifest', error.message);
    });

    it('throws a UsageError naming the path when the file is missing', async () => {
        const error = await catchAsyncError(() => read(null));

        assertEqual('UsageError', error?.name);
        assertEqual(`Missing secrets manifest: ${ FILEPATH }`, error.message);
    });

    it('turns the parser\'s OperationalError into a UsageError that names the file and the line', async () => {
        const error = await catchAsyncError(() => read('A=\nnot an entry\n'));

        assertEqual('UsageError', error?.name);
        assertMatches(`Invalid secrets manifest ${ FILEPATH }`, error.message);
        assertMatches('on line 2', error.message);
        assertMatches('expected NAME=value', error.message);
    });

    // A malformed line may be a pasted secret value, and core's parser quotes
    // the line it could not read.
    it('never puts the text of a line in a message', async () => {
        const pasted = 'sk-live-0123456789abcdef';
        const error = await catchAsyncError(() => read(`A=first-value\n  ${ pasted }  \nB=second-value\n`));

        assertEqual('UsageError', error?.name);
        assert(!error.message.includes(pasted), 'the message holds the line');
        assert(!error.message.includes('first-value'), 'the message holds a value');
        assertMatches('on line 2', error.message);
        assertMatches('(not shown)', error.message);

        // The parser's error would carry the line with it.
        assertEqual(undefined, error.cause);
    });

    it('lets any other error from the parser through as a defect', async () => {
        const defect = new TypeError('broken parser');

        const error = await catchAsyncError(() => read('A=\n', {
            parseSecretsManifest() {
                throw defect;
            },
        }));

        assertEqual(defect, error);
    });

    it('refuses a name the deployment tool owns, in any list', async () => {
        const manifests = [
            'BUILD_ID=\n',
            '# @optional\nENVIRONMENT=\n',
            '# @required-outside-development\nBUILD_ID=\n',
        ];

        for (const text of manifests) {
            // eslint-disable-next-line no-await-in-loop
            const error = await catchAsyncError(() => read(text));

            assertEqual('UsageError', error?.name);
            assertMatches(FILEPATH, error.message);
            assertMatches('is reserved by the deployment tool', error.message);
        }
    });
});
