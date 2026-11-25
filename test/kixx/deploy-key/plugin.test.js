import { describe } from 'kixx-test';
import { assert, assertEqual, assertFalsy } from 'kixx-assert';

import { register } from '../../../kixx/deploy-key/plugin.js';


const VALID_HASH = '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0';

const EXPECTED_MESSAGE = 'DEPLOY_KEY_HASH must be the SHA-256 of the deploy key, as 64 lowercase hex characters.';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

function makeContext(env) {
    return { env, config: { environment: 'production' } };
}


describe('deploy-key plugin register()', ({ it }) => {
    it('passes when the hash is absent or empty', () => {
        assertEqual(null, catchError(() => register(makeContext({}))));
        assertEqual(null, catchError(() => register(makeContext({ DEPLOY_KEY_HASH: '' }))));
    });

    it('passes a well-formed hash', () => {
        assertEqual(null, catchError(() => register(makeContext({ DEPLOY_KEY_HASH: VALID_HASH }))));
    });

    it('fails boot on a malformed hash, naming the secret and never the value', () => {
        const values = [
            'not-a-hash',
            VALID_HASH.toUpperCase(),
            `${ VALID_HASH }ab`,
            VALID_HASH.slice(2),
            `kxdk_${ VALID_HASH }`,
        ];

        for (const value of values) {
            const caught = catchError(() => register(makeContext({ DEPLOY_KEY_HASH: value })));

            assert(caught, `expected ${ value } to fail`);
            assertEqual('OperationalError', caught.name);
            assertEqual(EXPECTED_MESSAGE, caught.message);
            assertFalsy(caught.message.includes(value));
            assertFalsy(String(caught.stack).includes(value));
        }
    });
});
