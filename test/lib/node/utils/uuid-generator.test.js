import { describe } from 'kixx-test';
import { assert, assertMatches } from 'kixx-assert';
import { createRandomUUID } from '../../../../lib/node/utils/mod.js';


const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('NodeUtils#createRandomUUID() when called', ({ it }) => {
    it('returns a UUID v4 string', () => {
        assertMatches(UUID_V4_PATTERN, createRandomUUID());
    });

    it('returns a different value on each call', () => {
        assert(createRandomUUID() !== createRandomUUID());
    });
});
