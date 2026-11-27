import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import matchesIfNoneMatch from '../../../kixx/http-router/matches-if-none-match.js';

describe('matchesIfNoneMatch', ({ it }) => {
    it('weakly matches lists and the wildcard', () => {
        assertEqual(true, matchesIfNoneMatch('"old", W/"generation-2"', '"generation-2"'));
        assertEqual(true, matchesIfNoneMatch('*', '"generation-2"'));
        assertEqual(false, matchesIfNoneMatch('"old"', '"generation-2"'));
    });

    it('matches a weak current validator against a strong candidate', () => {
        assertEqual(true, matchesIfNoneMatch('"generation-2"', 'W/"generation-2"'));
    });

    it('does not match a missing or empty header', () => {
        assertEqual(false, matchesIfNoneMatch(null, '"generation-2"'));
        assertEqual(false, matchesIfNoneMatch(undefined, '"generation-2"'));
        assertEqual(false, matchesIfNoneMatch('', '"generation-2"'));
    });
});
