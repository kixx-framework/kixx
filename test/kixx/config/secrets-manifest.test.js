import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertNotMatches,
} from 'kixx-assert';

import {
    parseSecretsManifest,
    compareSecretNames,
    assertDeclaredSecrets,
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
            assertEqual(0, manifest.requiredOutsideDevelopment.length);
        });

        it('classifies entries marked @required-outside-development, mixed with @optional', () => {
            const manifest = parseSecretsManifest([
                '# @required-outside-development',
                '# Explanation for the entry.',
                'ZULU_HASH=replace-me',
                '',
                '# @optional',
                'OPTIONAL_SECRET=replace-me',
                '',
                '    # @required-outside-development',
                'ALPHA_HASH=replace-me',
                'PLAIN_SECRET=replace-me',
            ].join('\n'));

            assertEqual('PLAIN_SECRET', manifest.required.join(','));
            assertEqual('OPTIONAL_SECRET', manifest.optional.join(','));
            assertEqual('ALPHA_HASH,ZULU_HASH', manifest.requiredOutsideDevelopment.join(','));
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
            assertMatches('second directive, @optional,', caught.message);
        });

        it('rejects a @required-outside-development directive followed by a blank line', () => {
            const source = '# @required-outside-development\n# Comment\n\nNAME=value';
            const caught = catchError(() => parseSecretsManifest(source));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('line 1', caught.message);
            assertMatches('the @required-outside-development directive must be followed by an entry', caught.message);
        });

        it('rejects a @required-outside-development directive at the end of the file', () => {
            const caught = catchError(() => parseSecretsManifest('NAME=value\n# @required-outside-development\n'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertMatches('line 2', caught.message);
            assertMatches('must be followed by an entry', caught.message);
        });

        it('rejects a second directive of either kind before an entry', () => {
            const sources = [
                '# @required-outside-development\n# @required-outside-development\nNAME=value',
                '# @optional\n# @required-outside-development\nNAME=value',
                '# @required-outside-development\n# @optional\nNAME=value',
            ];

            for (const source of sources) {
                const caught = catchError(() => parseSecretsManifest(source));

                assert(caught, `expected ${ JSON.stringify(source) } to be rejected`);
                assertEqual('OperationalError', caught.name);
                assertMatches('line 2', caught.message);
                assertMatches('second directive', caught.message);
            }
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
                    requiredOutsideDevelopment: [],
                },
                liveNames: ['PRESENT_SECRET', 'EXTRA_Z', 'EXTRA_A', 'EXTRA_Z'],
                environment: 'production',
            });

            assertEqual('ALPHA_SECRET,ZEBRA_SECRET', comparison.missing.join(','));
            assertEqual('EXTRA_A,EXTRA_Z', comparison.extra.join(','));
        });

        it('does not report a present optional name as extra', () => {
            const comparison = compareSecretNames({
                manifest: {
                    required: [],
                    optional: ['OPTIONAL_SECRET'],
                    requiredOutsideDevelopment: [],
                },
                liveNames: ['OPTIONAL_SECRET'],
                environment: 'production',
            });

            assertEqual(0, comparison.missing.length);
            assertEqual(0, comparison.extra.length);
        });

        it('reports a name required outside development as missing outside development only', () => {
            const manifest = {
                required: [ 'PLAIN_SECRET' ],
                optional: [],
                requiredOutsideDevelopment: [ 'OUTSIDE_HASH' ],
            };

            const production = compareSecretNames({ manifest, liveNames: [], environment: 'production' });
            const development = compareSecretNames({ manifest, liveNames: [], environment: 'development' });

            assertEqual('OUTSIDE_HASH,PLAIN_SECRET', production.missing.join(','));
            assertEqual('PLAIN_SECRET', development.missing.join(','));
        });

        it('does not report a present name required outside development as extra', () => {
            const comparison = compareSecretNames({
                manifest: { required: [], optional: [], requiredOutsideDevelopment: [ 'OUTSIDE_HASH' ] },
                liveNames: [ 'OUTSIDE_HASH' ],
                environment: 'development',
            });

            assertEqual(0, comparison.missing.length);
            assertEqual(0, comparison.extra.length);
        });

        it('throws an AssertionError without an environment or the third list', () => {
            const manifest = { required: [], optional: [], requiredOutsideDevelopment: [] };
            const cases = [
                { manifest, liveNames: [] },
                { manifest, liveNames: [], environment: '' },
                { manifest: { required: [], optional: [] }, liveNames: [], environment: 'production' },
            ];

            for (const options of cases) {
                const caught = catchError(() => compareSecretNames(options));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
            }
        });
    });

    describe('assertDeclaredSecrets', ({ describe, it }) => {
        const MISSING_MESSAGE_SUFFIX = 'Every declared secret is listed in example.env.secrets.';

        const IN_PRODUCTION = { environment: 'production' };
        const IN_DEVELOPMENT = { environment: 'development' };

        function makeSecrets() {
            return {
                required: [ 'ZEBRA_SECRET', 'ALPHA_SECRET', 'MIDDLE_SECRET' ],
                optional: [ 'OPTIONAL_SECRET' ],
                requiredOutsideDevelopment: [],
            };
        }

        it('passes when every required and optional secret is present', () => {
            const env = {
                ZEBRA_SECRET: 'z-value',
                ALPHA_SECRET: 'a-value',
                MIDDLE_SECRET: 'm-value',
                OPTIONAL_SECRET: 'o-value',
            };

            assertEqual(null, catchError(() => assertDeclaredSecrets(env, makeSecrets(), IN_PRODUCTION)));
        });

        it('passes when an optional secret is absent', () => {
            const env = {
                ZEBRA_SECRET: 'z-value',
                ALPHA_SECRET: 'a-value',
                MIDDLE_SECRET: 'm-value',
            };

            assertEqual(null, catchError(() => assertDeclaredSecrets(env, makeSecrets(), IN_PRODUCTION)));
        });

        it('passes when nothing is declared', () => {
            const caught = catchError(() => assertDeclaredSecrets({}, { required: [], optional: [], requiredOutsideDevelopment: [] }, IN_PRODUCTION));

            assertEqual(null, caught);
        });

        it('reports every missing required secret in one error, sorted by name', () => {
            const caught = catchError(() => assertDeclaredSecrets({ MIDDLE_SECRET: 'm-value' }, makeSecrets(), IN_PRODUCTION));

            assert(caught, 'expected an error to be thrown');
            assertEqual('OperationalError', caught.name);
            assertEqual('OPERATIONAL_ERROR', caught.code);
            assertEqual(
                `Missing required environment secrets: ALPHA_SECRET, ZEBRA_SECRET. ${ MISSING_MESSAGE_SUFFIX }`,
                caught.message,
            );
        });

        it('counts an empty string as missing', () => {
            const env = {
                ZEBRA_SECRET: 'z-value',
                ALPHA_SECRET: '',
                MIDDLE_SECRET: 'm-value',
            };

            const caught = catchError(() => assertDeclaredSecrets(env, makeSecrets(), IN_PRODUCTION));

            assert(caught, 'expected an error to be thrown');
            assertEqual(`Missing required environment secrets: ALPHA_SECRET. ${ MISSING_MESSAGE_SUFFIX }`, caught.message);
        });

        it('counts a value that is not a string as missing', () => {
            const env = {
                ZEBRA_SECRET: 'z-value',
                ALPHA_SECRET: 'a-value',
                MIDDLE_SECRET: { get() {} },
            };

            const caught = catchError(() => assertDeclaredSecrets(env, makeSecrets(), IN_PRODUCTION));

            assert(caught, 'expected an error to be thrown');
            assertEqual(`Missing required environment secrets: MIDDLE_SECRET. ${ MISSING_MESSAGE_SUFFIX }`, caught.message);
        });

        it('names only the missing secrets and holds no value from the environment', () => {
            const env = {
                ZEBRA_SECRET: 'z-value-5f2c',
                MIDDLE_SECRET: 'm-value-91ab',
                OPTIONAL_SECRET: 'o-value-77de',
                BUILD_ID: 'build-3e40',
                UNDECLARED_SECRET: 'u-value-c0d1',
            };

            const caught = catchError(() => assertDeclaredSecrets(env, makeSecrets(), IN_PRODUCTION));

            assert(caught, 'expected an error to be thrown');
            assertMatches('ALPHA_SECRET', caught.message);

            for (const [ name, value ] of Object.entries(env)) {
                assertNotMatches(value, caught.message);
                assertNotMatches(name, caught.message);
            }
        });

        it('does not reorder the declared lists', () => {
            const secrets = makeSecrets();

            catchError(() => assertDeclaredSecrets({}, secrets, IN_PRODUCTION));

            assertEqual('ZEBRA_SECRET,ALPHA_SECRET,MIDDLE_SECRET', secrets.required.join(','));
        });

        it('throws an AssertionError when a declared list is not an Array', () => {
            const cases = [
                undefined,
                {},
                { required: [] },
                { optional: [] },
                { required: [], optional: [] },
            ];

            for (const secrets of cases) {
                const caught = catchError(() => assertDeclaredSecrets({}, secrets, IN_PRODUCTION));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
            }
        });

        it('throws an AssertionError without an environment', () => {
            for (const options of [ undefined, {}, { environment: '' }, { environment: 7 } ]) {
                const caught = catchError(() => assertDeclaredSecrets({}, makeSecrets(), options));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
            }
        });

        describe('a secret required outside development', ({ it }) => {
            const secrets = {
                required: [ 'PLAIN_SECRET' ],
                optional: [],
                requiredOutsideDevelopment: [ 'OUTSIDE_HASH' ],
            };

            it('may be absent in development', () => {
                const env = { PLAIN_SECRET: 'p-value' };

                assertEqual(null, catchError(() => assertDeclaredSecrets(env, secrets, IN_DEVELOPMENT)));
            });

            it('is still required alongside the plain names in development', () => {
                const caught = catchError(() => assertDeclaredSecrets({}, secrets, IN_DEVELOPMENT));

                assertEqual(`Missing required environment secrets: PLAIN_SECRET. ${ MISSING_MESSAGE_SUFFIX }`, caught.message);
            });

            it('is missing outside development, named with the others and holding no value', () => {
                const env = { PLAIN_SECRET: '', OTHER: 'o-value-8b1e' };

                for (const environment of [ 'production', 'test', 'staging' ]) {
                    const caught = catchError(() => assertDeclaredSecrets(env, secrets, { environment }));

                    assert(caught, `expected ${ environment } to fail`);
                    assertEqual('OperationalError', caught.name);
                    assertEqual(
                        `Missing required environment secrets: OUTSIDE_HASH, PLAIN_SECRET. ${ MISSING_MESSAGE_SUFFIX }`,
                        caught.message,
                    );
                    assertNotMatches('o-value-8b1e', caught.message);
                }
            });

            it('counts an empty string as missing outside development', () => {
                const env = { PLAIN_SECRET: 'p-value', OUTSIDE_HASH: '' };
                const caught = catchError(() => assertDeclaredSecrets(env, secrets, IN_PRODUCTION));

                assertEqual(`Missing required environment secrets: OUTSIDE_HASH. ${ MISSING_MESSAGE_SUFFIX }`, caught.message);
            });

            it('passes outside development when present', () => {
                const env = { PLAIN_SECRET: 'p-value', OUTSIDE_HASH: 'h-value' };

                assertEqual(null, catchError(() => assertDeclaredSecrets(env, secrets, IN_PRODUCTION)));
            });

            it('does not reorder the declared lists', () => {
                catchError(() => assertDeclaredSecrets({}, secrets, IN_PRODUCTION));

                assertEqual('PLAIN_SECRET', secrets.required.join(','));
                assertEqual('OUTSIDE_HASH', secrets.requiredOutsideDevelopment.join(','));
            });
        });
    });
});
