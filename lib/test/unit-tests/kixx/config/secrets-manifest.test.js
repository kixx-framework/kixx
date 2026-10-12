import fs from 'node:fs';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import {
    parseSecretsManifest,
    compareSecretNames,
} from '../../../../src/kixx/config/secrets-manifest.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('secrets-manifest', ({ describe }) => {

    describe('parseSecretsManifest', ({ it }) => {
        it('parses, classifies, and sorts secret names', () => {
            const manifest = parseSecretsManifest([
                'ZEBRA_SECRET=ignored=value',
                '',
                '    # @optional',
                '    # Explanation for the optional entry.',
                '    OPTIONAL_SECRET=ignored',
                'ALPHA_SECRET=ignored',
            ].join('\r\n'));

            assertEqual('ALPHA_SECRET,ZEBRA_SECRET', manifest.required.join(','));
            assertEqual('OPTIONAL_SECRET', manifest.optional.join(','));
        });

        it('parses the committed secrets manifest', () => {
            const source = fs.readFileSync('src/example.env.secrets', 'utf8');
            const manifest = parseSecretsManifest(source);

            assertEqual(
                'CSRF_TOKEN_SIGNING_SECRET,DOCUMENT_STORE_CURSOR_SIGNING_SECRET',
                manifest.required.join(','),
            );
            assertEqual('ADMIN_BOOTSTRAP_TOKEN', manifest.optional.join(','));
        });

        it('rejects an entry without a value separator', () => {
            const caught = catchError(() => parseSecretsManifest('VALID=value\nMALFORMED'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('line 2', caught.message);
            assertMatches('NAME=value', caught.message);
        });

        it('rejects an invalid secret name', () => {
            const caught = catchError(() => parseSecretsManifest('NOT-VALID=value'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('line 1', caught.message);
            assertMatches('invalid secret name "NOT-VALID"', caught.message);
        });

        it('rejects a duplicate across required and optional entries', () => {
            const source = 'DUPLICATE=value\n# @optional\nDUPLICATE=other';
            const caught = catchError(() => parseSecretsManifest(source));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('line 3', caught.message);
            assertMatches('duplicate secret name "DUPLICATE"', caught.message);
        });

        it('rejects an optional directive followed by a blank line', () => {
            const caught = catchError(() => parseSecretsManifest('# @optional\n# Comment\n\nNAME=value'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('line 1', caught.message);
            assertMatches('must be followed by an entry', caught.message);
        });

        it('rejects a second optional directive before an entry', () => {
            const caught = catchError(() => parseSecretsManifest('# @optional\n# @optional\nNAME=value'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('line 2', caught.message);
            assertMatches('second @optional directive', caught.message);
        });

        it('rejects an optional directive at the end of the file', () => {
            const caught = catchError(() => parseSecretsManifest('NAME=value\n# @optional'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('line 2', caught.message);
            assertMatches('must be followed by an entry', caught.message);
        });
    });

    describe('compareSecretNames', ({ it }) => {
        it('reports sorted missing and extra names while ignoring optional absence', () => {
            const comparison = compareSecretNames({
                manifest: {
                    required: ['ZEBRA_SECRET', 'ALPHA_SECRET', 'PRESENT_SECRET'],
                    optional: ['OPTIONAL_SECRET'],
                },
                liveNames: ['PRESENT_SECRET', 'EXTRA_Z', 'EXTRA_A', 'EXTRA_Z'],
            });

            assertEqual('ALPHA_SECRET,ZEBRA_SECRET', comparison.missing.join(','));
            assertEqual('EXTRA_A,EXTRA_Z', comparison.extra.join(','));
        });

        it('does not report a present optional name as extra', () => {
            const comparison = compareSecretNames({
                manifest: {
                    required: [],
                    optional: ['OPTIONAL_SECRET'],
                },
                liveNames: ['OPTIONAL_SECRET'],
            });

            assertEqual(0, comparison.missing.length);
            assertEqual(0, comparison.extra.length);
        });
    });
});
