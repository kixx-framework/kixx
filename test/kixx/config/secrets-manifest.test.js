import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import {
    parseSecretsManifest,
    compareSecretNames,
} from '../../../kixx/config/secrets-manifest.js';


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

        it('parses a manifest with comment blocks and an @optional entry', () => {
            // The v6 starter app's example.env.secrets, inlined so the test
            // reads no file.
            const source = `
            # This file is two things at once.
            #
            # It is the template for .env.<environment>.secrets, the local, never-committed
            # file the Node.js server reads its secret values from:
            #     cp example.env.secrets .env.development.secrets
            #
            # It is also the manifest of the secret *names* every deployment must provide.
            # Only the names are read; the values are placeholders and are ignored. The
            # Node.js server will refuse to boot when a required name is missing from its
            # merged environment.
            #
            # For Cloudflare, every active (uncommented) assignment here is a declared
            # Worker secret, shared by all environments. Builds never read a local secrets
            # file: each declared name is inherited from the Worker version recorded in
            # .kixx/cloudflare-state.<environment>.json, and a missing value fails the
            # build.
            #
            # Adding a name here makes it required by the deployment tool.
            #
            # Order of operations, in both directions:
            #     Adding a secret:   add the name here, set it, then deploy the code that reads it.
            #     Removing a secret: deploy the code that stopped reading it, remove the
            #                        name here, then delete it.

            # Rotating DOCUMENT_STORE_CURSOR_SIGNING_SECRET invalidates every cursor
            # currently in flight — anyone mid-pagination gets a 400 on their next page.
            DOCUMENT_STORE_CURSOR_SIGNING_SECRET=secure-long-random-string

            # Rotating CSRF_TOKEN_SIGNING_SECRET invalidates every CSRF form currently
            # open — anyone mid-edit gets a rejection on submit.
            CSRF_TOKEN_SIGNING_SECRET=secure-long-random-string

            # @optional
            # Deleted after bootstrapping the first admin user, so it is absent from a
            # deployment for all of that deployment's normal life.
            ADMIN_BOOTSTRAP_TOKEN=dev_admin_bootstrap_token_change_me
`;
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
