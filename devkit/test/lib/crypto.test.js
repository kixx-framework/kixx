import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../lib/vendor/kixx-assert/mod.js';
import { generateSecretToken, generateShortId } from '../../lib/crypto.js';


describe('crypto', ({ describe }) => {

    describe('generateSecretToken()', ({ it }) => {
        it('returns 64 lowercase hex characters', () => {
            assertMatches(/^[0-9a-f]{64}$/, generateSecretToken());
        });

        it('prepends a string prefix', () => {
            assertMatches(/^pre_[0-9a-f]{64}$/, generateSecretToken('pre_'));
        });

        it('rejects a non-string prefix', () => {
            let caught = null;

            try {
                generateSecretToken(42);
            } catch (error) {
                caught = error;
            }

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('generateShortId()', ({ it }) => {
        it('returns a 22 character Base62 id', () => {
            assertMatches(/^[0-9A-Za-z]{22}$/, generateShortId());
        });
    });
});
