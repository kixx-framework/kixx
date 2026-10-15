import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';
import { parseSecretsManifest, readSecretsManifest } from '../../../lib/cloudflare/secrets-manifest.js';
import createMemoryFileSystem from '../../helpers/memory-file-system.js';


describe('cloudflare/secrets-manifest', ({ describe }) => {

    describe('parseSecretsManifest()', ({ it }) => {
        it('splits required and @optional names, each sorted, ignoring values', () => {
            const manifest = parseSecretsManifest([
                '# Comment',
                'ZETA=placeholder',
                '',
                '  # @optional',
                '# explanation for the optional entry',
                'OPTIONAL_ONE=x',
                'ALPHA=',
            ].join('\n'));

            assertEqual('ALPHA,ZETA', manifest.required.join(','));
            assertEqual('OPTIONAL_ONE', manifest.optional.join(','));
            assert(!JSON.stringify(manifest).includes('placeholder'), 'expected no values');
        });

        it('returns empty lists for an empty file', () => {
            const manifest = parseSecretsManifest('');

            assertEqual(0, manifest.required.length);
            assertEqual(0, manifest.optional.length);
        });

        it('rejects each malformed input naming example.env.secrets and the line', () => {
            const cases = [
                [ 'A=1\nnot an assignment', 2, 'NAME=value' ],
                [ '1BAD=x', 1, 'invalid secret name "1BAD"' ],
                [ 'A=1\nA=2', 2, 'duplicate secret name "A"' ],
                [ '# @optional\n\nA=1', 1, '@optional directive must be followed by an entry' ],
                [ 'A=1\n# @optional', 2, '@optional directive must be followed by an entry' ],
                [ '# @optional\n# @optional\nA=1', 2, 'a second @optional directive' ],
                [ 'BUILD_ID=x', 1, '"BUILD_ID" is reserved' ],
                [ '# @optional\nENVIRONMENT=x', 2, '"ENVIRONMENT" is reserved' ],
            ];

            for (const [ text, lineNumber, detail ] of cases) {
                const caught = catchError(() => parseSecretsManifest(text));

                assert(caught, `expected ${ JSON.stringify(text) } to be rejected`);
                assertEqual('UsageError', caught.name);
                assert(caught.message.includes(`example.env.secrets on line ${ lineNumber }`), caught.message);
                assert(caught.message.includes(detail), caught.message);
            }
        });

        it('does not echo a malformed line, which may hold a pasted value', () => {
            const caught = catchError(() => parseSecretsManifest('SECRET_VALUE_MUST_NOT_ESCAPE'));

            assert(caught, 'expected an error');
            assert(!caught.message.includes('SECRET_VALUE_MUST_NOT_ESCAPE'), caught.message);
        });
    });

    describe('readSecretsManifest()', ({ it }) => {
        it('reads <project>/example.env.secrets and names it in errors', async () => {
            const fileSystem = createMemoryFileSystem({ '/app/example.env.secrets': 'A=1\nbad line' });

            const caught = await catchAsyncError(() => readSecretsManifest({ projectDirectory: '/app', fileSystem }));

            assert(caught, 'expected an error');
            assert(caught.message.includes('/app/example.env.secrets on line 2'), caught.message);
        });

        it('returns the parsed manifest', async () => {
            const fileSystem = createMemoryFileSystem({ '/app/example.env.secrets': 'A=1\n# @optional\nB=2' });

            const manifest = await readSecretsManifest({ projectDirectory: '/app', fileSystem });

            assertEqual('A', manifest.required.join(','));
            assertEqual('B', manifest.optional.join(','));
        });

        it('throws a UsageError naming the path when the file is missing', async () => {
            const fileSystem = createMemoryFileSystem({});

            const caught = await catchAsyncError(() => readSecretsManifest({ projectDirectory: '/app', fileSystem }));

            assert(caught, 'expected an error');
            assertEqual('UsageError', caught.name);
            assert(caught.message.includes('/app/example.env.secrets'), caught.message);
        });
    });
});

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
