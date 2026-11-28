import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';
import {
    compareDeclaredSecrets,
    isSecretBinding,
    readSecretBindingNames,
} from '../../../lib/cloudflare/worker-secret-names.js';


describe('cloudflare/worker-secret-names', ({ describe }) => {

    describe('isSecretBinding()', ({ it }) => {
        it('accepts secret_text and secret_key bindings only', () => {
            assertEqual(true, isSecretBinding({ type: 'secret_text', name: 'A' }));
            assertEqual(true, isSecretBinding({ type: 'secret_key', name: 'B' }));
            assertEqual(false, isSecretBinding({ type: 'plain_text', name: 'C', text: 'visible' }));
            assertEqual(false, isSecretBinding({ type: 'inherit', name: 'D' }));
            assertEqual(false, isSecretBinding(null));
        });
    });

    describe('readSecretBindingNames()', ({ it }) => {
        it('returns sorted unique secret binding names, ignoring other binding types', () => {
            const names = readSecretBindingNames({
                id: 'version-id',
                bindings: [
                    { type: 'secret_text', name: 'ZETA' },
                    { type: 'plain_text', name: 'PLAIN', text: 'visible' },
                    { type: 'secret_key', name: 'ALPHA' },
                    { type: 'secret_text', name: 'ZETA' },
                ],
            });

            assertEqual('ALPHA,ZETA', names.join(','));
        });

        it('reads bindings nested under resources', () => {
            const names = readSecretBindingNames({
                id: 'version-id',
                resources: { bindings: [ { type: 'secret_text', name: 'A' } ] },
            });

            assertEqual('A', names.join(','));
        });

        it('throws naming the version when the bindings list is absent', () => {
            let caught = null;
            try {
                readSecretBindingNames({ id: 'version-id' });
            } catch (error) {
                caught = error;
            }

            assert(caught, 'expected an error to be thrown');
            assert(caught.message.includes('version-id'), 'expected the version ID');
            assert(caught.message.includes('without a bindings list'), 'expected the missing list explanation');
        });
    });

    describe('compareDeclaredSecrets()', ({ it }) => {
        const manifest = { required: [ 'ALPHA', 'BETA' ], optional: [ 'BOOTSTRAP' ] };

        it('passes an exact match and inherits every declared name', () => {
            const result = compareDeclaredSecrets({ manifest, remoteNames: [ 'BOOTSTRAP', 'BETA', 'ALPHA' ] });

            assertEqual('', result.missingRequired.join(','));
            assertEqual('', result.undeclared.join(','));
            assertEqual('ALPHA,BETA,BOOTSTRAP', result.inheritedNames.join(','));
        });

        it('reports a missing required name', () => {
            const result = compareDeclaredSecrets({ manifest, remoteNames: [ 'BETA' ] });

            assertEqual('ALPHA', result.missingRequired.join(','));
            assertEqual('', result.undeclared.join(','));
        });

        it('reports undeclared remote names, sorted and unique', () => {
            const result = compareDeclaredSecrets({
                manifest,
                remoteNames: [ 'ALPHA', 'BETA', 'ZULU', 'OLD', 'ZULU' ],
            });

            assertEqual('', result.missingRequired.join(','));
            assertEqual('OLD,ZULU', result.undeclared.join(','));
        });

        it('passes with an optional name absent and does not inherit it', () => {
            const result = compareDeclaredSecrets({ manifest, remoteNames: [ 'ALPHA', 'BETA' ] });

            assertEqual('', result.missingRequired.join(','));
            assertEqual('', result.undeclared.join(','));
            assertEqual('ALPHA,BETA', result.inheritedNames.join(','));
        });

        it('does not count a plain_text binding with a declared name', () => {
            const remoteNames = readSecretBindingNames({
                id: 'version-id',
                bindings: [
                    { type: 'secret_text', name: 'ALPHA' },
                    { type: 'plain_text', name: 'BETA', text: 'visible' },
                ],
            });

            const result = compareDeclaredSecrets({ manifest, remoteNames });

            assertEqual('BETA', result.missingRequired.join(','));
        });
    });
});
