import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import { ALPHA, OMEGA } from '../../lib/lib/constants.js';
import {
    isGreaterThan,
    isGreaterThanOrEqualTo,
    isLessThan,
    isLessThanOrEqualTo,
    sortIndexListAscending,
    sortIndexListDescending,
    findLeftmostPositionAscending,
    findRightmostPositionAscending,
    findLeftmostPositionDescending,
    findRightmostPositionDescending,
    getAscendingIndexRange,
    getDescendingIndexRange
} from '../../lib/local-file-datastore/binary-search.js';

describe('binary-search isGreaterThan', ({ it }) => {
    it('returns true when first string is greater than second string', () => {
        assertEqual(true, isGreaterThan('z', 'a'), 'z should be greater than a');
        assertEqual(true, isGreaterThan('m', 'a'), 'm should be greater than a');
        assertEqual(true, isGreaterThan('z', 'm'), 'z should be greater than m');
    });

    it('returns false when first string is less than second string', () => {
        assertEqual(false, isGreaterThan('a', 'z'), 'a should not be greater than z');
        assertEqual(false, isGreaterThan('a', 'm'), 'a should not be greater than m');
        assertEqual(false, isGreaterThan('m', 'z'), 'm should not be greater than z');
    });

    it('returns false when strings are equal', () => {
        assertEqual(false, isGreaterThan('a', 'a'), 'a should not be greater than a');
        assertEqual(false, isGreaterThan('hello', 'hello'), 'hello should not be greater than hello');
    });

    it('handles numeric strings with lexical comparison', () => {
        assertEqual(false, isGreaterThan('10', '2'), '10 should not be greater than 2 (lexical)');
        assertEqual(true, isGreaterThan('2', '10'), '2 should be greater than 10 (lexical)');
    });

    it('handles international characters with locale-aware comparison', () => {
        assertEqual(true, isGreaterThan('ñ', 'n'), 'ñ should be greater than n');
        assertEqual(true, isGreaterThan('ö', 'o'), 'ö should be greater than o');
    });

    it('handles numbers correctly', () => {
        assertEqual(true, isGreaterThan(10, 2), '10 should be greater than 2');
        assertEqual(false, isGreaterThan(2, 10), '2 should not be greater than 10');
        assertEqual(false, isGreaterThan(5, 5), '5 should not be greater than 5');
    });

    it('handles dates correctly', () => {
        const date1 = new Date(2023, 0, 2);
        const date2 = new Date(2023, 0, 1);
        assertEqual(true, isGreaterThan(date1, date2), 'later date should be greater');
        assertEqual(false, isGreaterThan(date2, date1), 'earlier date should not be greater');
    });
});

describe('binary-search isGreaterThanOrEqualTo', ({ it }) => {
    it('returns true when first string is greater than second string', () => {
        assertEqual(true, isGreaterThanOrEqualTo('z', 'a'), 'z should be greater than or equal to a');
        assertEqual(true, isGreaterThanOrEqualTo('m', 'a'), 'm should be greater than or equal to a');
    });

    it('returns true when strings are equal', () => {
        assertEqual(true, isGreaterThanOrEqualTo('a', 'a'), 'a should be greater than or equal to a');
        assertEqual(true, isGreaterThanOrEqualTo('hello', 'hello'), 'hello should be greater than or equal to hello');
    });

    it('returns false when first string is less than second string', () => {
        assertEqual(false, isGreaterThanOrEqualTo('a', 'z'), 'a should not be greater than or equal to z');
        assertEqual(false, isGreaterThanOrEqualTo('m', 'z'), 'm should not be greater than or equal to z');
    });

    it('handles numeric strings with lexical comparison', () => {
        assertEqual(false, isGreaterThanOrEqualTo('10', '2'), '10 should not be greater than or equal to 2 (lexical)');
        assertEqual(true, isGreaterThanOrEqualTo('2', '10'), '2 should be greater than or equal to 10 (lexical)');
        assertEqual(true, isGreaterThanOrEqualTo('2', '2'), '2 should be greater than or equal to 2');
    });

    it('handles international characters with locale-aware comparison', () => {
        assertEqual(true, isGreaterThanOrEqualTo('ñ', 'n'), 'ñ should be greater than or equal to n');
        assertEqual(true, isGreaterThanOrEqualTo('ö', 'o'), 'ö should be greater than or equal to o');
    });

    it('handles numbers correctly', () => {
        assertEqual(true, isGreaterThanOrEqualTo(10, 2), '10 should be greater than or equal to 2');
        assertEqual(false, isGreaterThanOrEqualTo(2, 10), '2 should not be greater than or equal to 10');
        assertEqual(true, isGreaterThanOrEqualTo(5, 5), '5 should be greater than or equal to 5');
    });

    it('handles dates correctly', () => {
        const date1 = new Date(2023, 0, 2);
        const date2 = new Date(2023, 0, 1);
        const date3 = new Date(2023, 0, 2);
        assertEqual(true, isGreaterThanOrEqualTo(date1, date2), 'later date should be greater than or equal to earlier');
        assertEqual(true, isGreaterThanOrEqualTo(date1, date3), 'same date should be greater than or equal to same');
        assertEqual(false, isGreaterThanOrEqualTo(date2, date1), 'earlier date should not be greater than or equal to later');
    });
});

describe('binary-search isLessThan', ({ it }) => {
    it('returns true when first string is less than second string', () => {
        assertEqual(true, isLessThan('a', 'z'), 'a should be less than z');
        assertEqual(true, isLessThan('a', 'm'), 'a should be less than m');
        assertEqual(true, isLessThan('m', 'z'), 'm should be less than z');
    });

    it('returns false when first string is greater than second string', () => {
        assertEqual(false, isLessThan('z', 'a'), 'z should not be less than a');
        assertEqual(false, isLessThan('m', 'a'), 'm should not be less than a');
        assertEqual(false, isLessThan('z', 'm'), 'z should not be less than m');
    });

    it('returns false when strings are equal', () => {
        assertEqual(false, isLessThan('a', 'a'), 'a should not be less than a');
        assertEqual(false, isLessThan('hello', 'hello'), 'hello should not be less than hello');
    });

    it('handles numeric strings with lexical comparison', () => {
        assertEqual(true, isLessThan('10', '2'), '10 should be less than 2 (lexical)');
        assertEqual(false, isLessThan('2', '10'), '2 should not be less than 10 (lexical)');
    });

    it('handles international characters with locale-aware comparison', () => {
        assertEqual(false, isLessThan('ñ', 'n'), 'ñ should not be less than n');
        assertEqual(false, isLessThan('ö', 'o'), 'ö should not be less than o');
    });

    it('handles numbers correctly', () => {
        assertEqual(false, isLessThan(10, 2), '10 should not be less than 2');
        assertEqual(true, isLessThan(2, 10), '2 should be less than 10');
        assertEqual(false, isLessThan(5, 5), '5 should not be less than 5');
    });

    it('handles dates correctly', () => {
        const date1 = new Date(2023, 0, 1);
        const date2 = new Date(2023, 0, 2);
        assertEqual(true, isLessThan(date1, date2), 'earlier date should be less than later');
        assertEqual(false, isLessThan(date2, date1), 'later date should not be less than earlier');
    });
});

describe('binary-search isLessThanOrEqualTo', ({ it }) => {
    it('returns true when first string is less than second string', () => {
        assertEqual(true, isLessThanOrEqualTo('a', 'z'), 'a should be less than or equal to z');
        assertEqual(true, isLessThanOrEqualTo('a', 'm'), 'a should be less than or equal to m');
    });

    it('returns true when strings are equal', () => {
        assertEqual(true, isLessThanOrEqualTo('a', 'a'), 'a should be less than or equal to a');
        assertEqual(true, isLessThanOrEqualTo('hello', 'hello'), 'hello should be less than or equal to hello');
    });

    it('returns false when first string is greater than second string', () => {
        assertEqual(false, isLessThanOrEqualTo('z', 'a'), 'z should not be less than or equal to a');
        assertEqual(false, isLessThanOrEqualTo('m', 'a'), 'm should not be less than or equal to a');
    });

    it('handles numeric strings with lexical comparison', () => {
        assertEqual(true, isLessThanOrEqualTo('10', '2'), '10 should be less than or equal to 2 (lexical)');
        assertEqual(false, isLessThanOrEqualTo('2', '10'), '2 should not be less than or equal to 10 (lexical)');
        assertEqual(true, isLessThanOrEqualTo('2', '2'), '2 should be less than or equal to 2');
    });

    it('handles international characters with locale-aware comparison', () => {
        assertEqual(false, isLessThanOrEqualTo('ñ', 'n'), 'ñ should not be less than or equal to n');
        assertEqual(false, isLessThanOrEqualTo('ö', 'o'), 'ö should not be less than or equal to o');
    });

    it('handles numbers correctly', () => {
        assertEqual(false, isLessThanOrEqualTo(10, 2), '10 should not be less than or equal to 2');
        assertEqual(true, isLessThanOrEqualTo(2, 10), '2 should be less than or equal to 10');
        assertEqual(true, isLessThanOrEqualTo(5, 5), '5 should be less than or equal to 5');
    });

    it('handles dates correctly', () => {
        const date1 = new Date(2023, 0, 1);
        const date2 = new Date(2023, 0, 2);
        const date3 = new Date(2023, 0, 1);
        assertEqual(true, isLessThanOrEqualTo(date1, date2), 'earlier date should be less than or equal to later');
        assertEqual(true, isLessThanOrEqualTo(date1, date3), 'same date should be less than or equal to same');
        assertEqual(false, isLessThanOrEqualTo(date2, date1), 'later date should not be less than or equal to earlier');
    });
});

describe('binary-search sortIndexListAscending', ({ it }) => {
    it('sorts index items in ascending order by key', () => {
        const items = [
            { key: 'z', value: 'last' },
            { key: 'm', value: 'middle' },
            { key: '10', value: 'ten' },
            { key: OMEGA, value: 'omega' },
            { key: '2', value: 'two' },
            { key: '1', value: 'one' },
            { key: 'a', value: 'a' },
            { key: 'o', value: 'o' },
            { key: 'ñ', value: 'n-tilde' },
            { key: ALPHA, value: 'alpha' },
            { key: 'n', value: 'n' },
            { key: 'Zebra', value: 'zebra' },
            { key: 'apple', value: 'apple' },
            { key: 'Banana', value: 'banana' },
        ];

        items.sort(sortIndexListAscending);

        assertEqual(ALPHA, items[0].key, 'first item should have key alpha');
        assertEqual('1', items[1].key, 'first item should have key 1');
        assertEqual('10', items[2].key, 'second item should have key 10 (lexical)');
        assertEqual('2', items[3].key, 'third item should have key 2');
        assertEqual('a', items[4].key, 'fourth item should have key a');
        assertEqual('apple', items[5].key, 'fifth item should have key apple');
        assertEqual('Banana', items[6].key, 'sixth item should have key Banana');
        assertEqual('m', items[7].key, 'seventh item should have key m');
        assertEqual('n', items[8].key, 'eighth item should have key n');
        assertEqual('ñ', items[9].key, 'ninth item should have key ñ');
        assertEqual('o', items[10].key, 'tenth item should have key o');
        assertEqual('z', items[11].key, 'eleventh item should have key z');
        assertEqual('Zebra', items[12].key, 'twelfth item should have key Zebra');
        assertEqual(OMEGA, items[13].key, 'thirteenth item should have key omega');
    });

    it('handles duplicate keys', () => {
        const items = [
            { key: 'b', value: 'second' },
            { key: 'a', value: 'first' },
            { key: 'b', value: 'duplicate' },
        ];

        items.sort(sortIndexListAscending);

        assertEqual('a', items[0].key, 'first item should have key a');
        assertEqual('b', items[1].key, 'second item should have key b');
        assertEqual('b', items[2].key, 'third item should have key b');
    });

    it('handles empty arrays', () => {
        const items = [];

        items.sort(sortIndexListAscending);

        assertEqual(0, items.length, 'empty array should remain empty');
    });

    it('handles single item arrays', () => {
        const items = [{ key: 'single', value: 'only' }];

        items.sort(sortIndexListAscending);

        assertEqual(1, items.length, 'single item array should have one item');
        assertEqual('single', items[0].key, 'single item should maintain its key');
    });
});

describe('binary-search sortIndexListDescending', ({ it }) => {
    it('sorts index items in descending order by key', () => {
        const items = [
            { key: 'z', value: 'last' },
            { key: 'm', value: 'middle' },
            { key: '10', value: 'ten' },
            { key: OMEGA, value: 'omega' },
            { key: '2', value: 'two' },
            { key: '1', value: 'one' },
            { key: 'a', value: 'a' },
            { key: 'o', value: 'o' },
            { key: 'ñ', value: 'n-tilde' },
            { key: ALPHA, value: 'alpha' },
            { key: 'n', value: 'n' },
            { key: 'Zebra', value: 'zebra' },
            { key: 'apple', value: 'apple' },
            { key: 'Banana', value: 'banana' },
        ];

        items.sort(sortIndexListDescending);

        assertEqual(OMEGA, items[0].key, 'first item should have key omega');
        assertEqual('Zebra', items[1].key, 'second item should have key Zebra');
        assertEqual('z', items[2].key, 'third item should have key z');
        assertEqual('o', items[3].key, 'fourth item should have key o');
        assertEqual('ñ', items[4].key, 'fifth item should have key ñ');
        assertEqual('n', items[5].key, 'sixth item should have key n');
        assertEqual('m', items[6].key, 'seventh item should have key m');
        assertEqual('Banana', items[7].key, 'eighth item should have key Banana');
        assertEqual('apple', items[8].key, 'ninth item should have key apple');
        assertEqual('a', items[9].key, 'tenth item should have key a');
        assertEqual('2', items[10].key, 'eleventh item should have key 2');
        assertEqual('10', items[11].key, 'twelfth item should have key 10 (lexical)');
        assertEqual('1', items[12].key, 'thirteenth item should have key 1');
        assertEqual(ALPHA, items[13].key, 'fourteenth item should have key alpha');
    });

    it('handles duplicate keys', () => {
        const items = [
            { key: 'b', value: 'second' },
            { key: 'a', value: 'first' },
            { key: 'b', value: 'duplicate' },
        ];

        items.sort(sortIndexListDescending);

        assertEqual('b', items[0].key, 'first item should have key b');
        assertEqual('b', items[1].key, 'second item should have key b');
        assertEqual('a', items[2].key, 'third item should have key a');
    });

    it('handles empty arrays', () => {
        const items = [];

        items.sort(sortIndexListDescending);

        assertEqual(0, items.length, 'empty array should remain empty');
    });

    it('handles single item arrays', () => {
        const items = [{ key: 'single', value: 'only' }];

        items.sort(sortIndexListDescending);

        assertEqual(1, items.length, 'single item array should have one item');
        assertEqual('single', items[0].key, 'single item should maintain its key');
    });
});

describe('binary-search findLeftmostPositionAscending', ({ it }) => {
    it('finds leftmost insertion point for target in ascending sorted array', () => {
        const sortedList = [
            { key: '1' },
            { key: '10' },
            { key: '2' },
            { key: 'a' },
            { key: 'apple' },
            { key: 'Banana' },
            { key: 'm' },
            { key: 'n' },
            { key: 'ñ' },
            { key: 'o' },
            { key: 'z' },
            { key: 'Zebra' },
        ].sort(sortIndexListAscending);

        assertEqual(0, findLeftmostPositionAscending(sortedList, ALPHA), 'target ALPHA should insert at position 0');
        assertEqual(0, findLeftmostPositionAscending(sortedList, '1'), 'target 1 should insert at position 0');
        assertEqual(1, findLeftmostPositionAscending(sortedList, '10'), 'target 10 should insert at position 1');
        assertEqual(2, findLeftmostPositionAscending(sortedList, '2'), 'target 2 should insert at position 2');
        assertEqual(3, findLeftmostPositionAscending(sortedList, 'a'), 'target a should insert at position 3');
        assertEqual(4, findLeftmostPositionAscending(sortedList, 'apple'), 'target apple should insert at position 4');
        assertEqual(5, findLeftmostPositionAscending(sortedList, 'Banana'), 'target Banana should insert at position 5');
        assertEqual(6, findLeftmostPositionAscending(sortedList, 'm'), 'target m should insert at position 6');
        assertEqual(7, findLeftmostPositionAscending(sortedList, 'n'), 'target n should insert at position 7');
        assertEqual(8, findLeftmostPositionAscending(sortedList, 'ñ'), 'target ñ should insert at position 8');
        assertEqual(9, findLeftmostPositionAscending(sortedList, 'o'), 'target o should insert at position 9');
        assertEqual(10, findLeftmostPositionAscending(sortedList, 'z'), 'target z should insert at position 10');
        assertEqual(11, findLeftmostPositionAscending(sortedList, 'Zebra'), 'target Zebra should insert at position 11');
        assertEqual(12, findLeftmostPositionAscending(sortedList, OMEGA), 'target OMEGA should insert at position 12');

        // Test insertion between existing elements
        assertEqual(0, findLeftmostPositionAscending(sortedList, '0'), 'target 0 should insert at position 0');
        assertEqual(0, findLeftmostPositionAscending(sortedList, '~'), 'target ~ should insert at position 0');
        assertEqual(2, findLeftmostPositionAscending(sortedList, '11'), 'target 11 should insert at position 2');
        assertEqual(4, findLeftmostPositionAscending(sortedList, 'A'), 'target A should insert at position 4');
    });

    it('handles empty arrays', () => {
        const sortedList = [];

        assertEqual(0, findLeftmostPositionAscending(sortedList, 'a'), 'target should insert at position 0 in empty array');
        assertEqual(0, findLeftmostPositionAscending(sortedList, 'z'), 'target should insert at position 0 in empty array');
    });

    it('handles single item arrays', () => {
        const sortedList = [{ key: 'm' }];

        assertEqual(0, findLeftmostPositionAscending(sortedList, 'a'), 'target a should insert at position 0');
        assertEqual(0, findLeftmostPositionAscending(sortedList, 'm'), 'target m should insert at position 0');
        assertEqual(1, findLeftmostPositionAscending(sortedList, 'z'), 'target z should insert at position 1');
    });

    it('handles duplicate keys correctly', () => {
        const sortedList = [
            { key: 'a' },
            { key: 'b' },
            { key: 'b' },
            { key: 'b' },
            { key: 'c' },
        ];

        assertEqual(0, findLeftmostPositionAscending(sortedList, 'a'), 'target a should insert at position 0');
        assertEqual(1, findLeftmostPositionAscending(sortedList, 'b'), 'target b should insert at leftmost position 1');
        assertEqual(4, findLeftmostPositionAscending(sortedList, 'c'), 'target c should insert at position 4');
        assertEqual(5, findLeftmostPositionAscending(sortedList, 'd'), 'target d should insert at position 5');
    });
});

describe('binary-search findRightmostPositionAscending', ({ it }) => {
    it('finds rightmost insertion point for target in ascending sorted array', () => {
        const sortedList = [
            { key: '1' },
            { key: '10' },
            { key: '2' },
            { key: 'a' },
            { key: 'apple' },
            { key: 'Banana' },
            { key: 'm' },
            { key: 'n' },
            { key: 'ñ' },
            { key: 'o' },
            { key: 'z' },
            { key: 'Zebra' },
        ].sort(sortIndexListAscending);

        assertEqual(0, findRightmostPositionAscending(sortedList, ALPHA), 'target ALPHA should insert at position 0');
        assertEqual(1, findRightmostPositionAscending(sortedList, '1'), 'target 1 should insert at position 1');
        assertEqual(2, findRightmostPositionAscending(sortedList, '10'), 'target 10 should insert at position 2');
        assertEqual(3, findRightmostPositionAscending(sortedList, '2'), 'target 2 should insert at position 3');
        assertEqual(4, findRightmostPositionAscending(sortedList, 'a'), 'target a should insert at position 4');
        assertEqual(5, findRightmostPositionAscending(sortedList, 'apple'), 'target apple should insert at position 5');
        assertEqual(6, findRightmostPositionAscending(sortedList, 'Banana'), 'target Banana should insert at position 6');
        assertEqual(7, findRightmostPositionAscending(sortedList, 'm'), 'target m should insert at position 7');
        assertEqual(8, findRightmostPositionAscending(sortedList, 'n'), 'target n should insert at position 8');
        assertEqual(9, findRightmostPositionAscending(sortedList, 'ñ'), 'target ñ should insert at position 9');
        assertEqual(10, findRightmostPositionAscending(sortedList, 'o'), 'target o should insert at position 10');
        assertEqual(11, findRightmostPositionAscending(sortedList, 'z'), 'target z should insert at position 11');
        assertEqual(12, findRightmostPositionAscending(sortedList, 'Zebra'), 'target Zebra should insert at position 12');
        assertEqual(12, findRightmostPositionAscending(sortedList, OMEGA), 'target OMEGA should insert at position 12');

        // Test insertion between existing elements
        assertEqual(0, findRightmostPositionAscending(sortedList, '0'), 'target 0 should insert at position 0');
        assertEqual(0, findRightmostPositionAscending(sortedList, '~'), 'target ~ should insert at position 0');
        assertEqual(2, findRightmostPositionAscending(sortedList, '11'), 'target 11 should insert at position 2');
        assertEqual(4, findRightmostPositionAscending(sortedList, 'A'), 'target A should insert at position 4');
    });

    it('handles empty arrays', () => {
        const sortedList = [];

        assertEqual(0, findRightmostPositionAscending(sortedList, 'a'), 'target should insert at position 0 in empty array');
        assertEqual(0, findRightmostPositionAscending(sortedList, 'z'), 'target should insert at position 0 in empty array');
    });

    it('handles single item arrays', () => {
        const sortedList = [{ key: 'm' }];

        assertEqual(0, findRightmostPositionAscending(sortedList, 'a'), 'target a should insert at position 0');
        assertEqual(1, findRightmostPositionAscending(sortedList, 'm'), 'target m should insert at position 1');
        assertEqual(1, findRightmostPositionAscending(sortedList, 'z'), 'target z should insert at position 1');
    });

    it('handles duplicate keys correctly', () => {
        const sortedList = [
            { key: 'a' },
            { key: 'b' },
            { key: 'b' },
            { key: 'b' },
            { key: 'c' },
        ];

        assertEqual(1, findRightmostPositionAscending(sortedList, 'a'), 'target a should insert at position 1');
        assertEqual(4, findRightmostPositionAscending(sortedList, 'b'), 'target b should insert at rightmost position 4');
        assertEqual(5, findRightmostPositionAscending(sortedList, 'c'), 'target c should insert at position 5');
        assertEqual(5, findRightmostPositionAscending(sortedList, 'd'), 'target d should insert at position 5');
    });
});

describe('binary-search findLeftmostPositionDescending', ({ it }) => {
    it('finds leftmost insertion point for target in descending sorted array', () => {
        const sortedList = [
            { key: '1' },
            { key: '10' },
            { key: '2' },
            { key: 'a' },
            { key: 'apple' },
            { key: 'Banana' },
            { key: 'm' },
            { key: 'n' },
            { key: 'ñ' },
            { key: 'o' },
            { key: 'z' },
            { key: 'Zebra' },
        ].sort(sortIndexListDescending);

        assertEqual(0, findLeftmostPositionDescending(sortedList, OMEGA), 'target OMEGA should insert at position 0');
        assertEqual(0, findLeftmostPositionDescending(sortedList, 'Zebra'), 'target Zebra should insert at position 0');
        assertEqual(1, findLeftmostPositionDescending(sortedList, 'z'), 'target z should insert at position 1');
        assertEqual(2, findLeftmostPositionDescending(sortedList, 'o'), 'target o should insert at position 2');
        assertEqual(3, findLeftmostPositionDescending(sortedList, 'ñ'), 'target ñ should insert at position 3');
        assertEqual(4, findLeftmostPositionDescending(sortedList, 'n'), 'target n should insert at position 4');
        assertEqual(5, findLeftmostPositionDescending(sortedList, 'm'), 'target m should insert at position 5');
        assertEqual(6, findLeftmostPositionDescending(sortedList, 'Banana'), 'target Banana should insert at position 6');
        assertEqual(7, findLeftmostPositionDescending(sortedList, 'apple'), 'target apple should insert at position 7');
        assertEqual(8, findLeftmostPositionDescending(sortedList, 'a'), 'target a should insert at position 8');
        assertEqual(9, findLeftmostPositionDescending(sortedList, '2'), 'target 2 should insert at position 9');
        assertEqual(10, findLeftmostPositionDescending(sortedList, '10'), 'target 10 should insert at position 10');
        assertEqual(11, findLeftmostPositionDescending(sortedList, '1'), 'target 1 should insert at position 11');
        assertEqual(12, findLeftmostPositionDescending(sortedList, ALPHA), 'target ALPHA should insert at position 12');

        // Test insertion between existing elements
        assertEqual(8, findLeftmostPositionDescending(sortedList, 'A'), 'target A should insert at position 8');
        assertEqual(10, findLeftmostPositionDescending(sortedList, '11'), 'target 11 should insert at position 10');
        assertEqual(12, findLeftmostPositionDescending(sortedList, '0'), 'target 0 should insert at position 12');
        assertEqual(12, findLeftmostPositionDescending(sortedList, '~'), 'target ~ should insert at position 12');
    });

    it('handles empty arrays', () => {
        const sortedList = [];

        assertEqual(0, findLeftmostPositionDescending(sortedList, 'a'), 'target should insert at position 0 in empty array');
        assertEqual(0, findLeftmostPositionDescending(sortedList, 'z'), 'target should insert at position 0 in empty array');
    });

    it('handles single item arrays', () => {
        const sortedList = [{ key: 'm' }];

        assertEqual(1, findLeftmostPositionDescending(sortedList, 'a'), 'target a should insert at position 1');
        assertEqual(0, findLeftmostPositionDescending(sortedList, 'm'), 'target m should insert at position 0');
        assertEqual(0, findLeftmostPositionDescending(sortedList, 'z'), 'target z should insert at position 0');
    });

    it('handles duplicate keys correctly', () => {
        const sortedList = [
            { key: 'c' },
            { key: 'b' },
            { key: 'b' },
            { key: 'b' },
            { key: 'a' },
        ];

        assertEqual(4, findLeftmostPositionDescending(sortedList, 'a'), 'target a should insert at position 4');
        assertEqual(1, findLeftmostPositionDescending(sortedList, 'b'), 'target b should insert at leftmost position 1');
        assertEqual(0, findLeftmostPositionDescending(sortedList, 'c'), 'target c should insert at position 0');
        assertEqual(0, findLeftmostPositionDescending(sortedList, 'd'), 'target d should insert at position 0');
    });
});

describe('binary-search findRightmostPositionDescending', ({ it }) => {
    it('finds rightmost insertion point for target in descending sorted array', () => {
        const sortedList = [
            { key: '1' },
            { key: '10' },
            { key: '2' },
            { key: 'a' },
            { key: 'apple' },
            { key: 'Banana' },
            { key: 'm' },
            { key: 'n' },
            { key: 'ñ' },
            { key: 'o' },
            { key: 'z' },
            { key: 'Zebra' },
        ].sort(sortIndexListDescending);

        assertEqual(0, findRightmostPositionDescending(sortedList, OMEGA), 'target OMEGA should insert at position 0');
        assertEqual(1, findRightmostPositionDescending(sortedList, 'Zebra'), 'target Zebra should insert at position 1');
        assertEqual(2, findRightmostPositionDescending(sortedList, 'z'), 'target z should insert at position 2');
        assertEqual(3, findRightmostPositionDescending(sortedList, 'o'), 'target o should insert at position 3');
        assertEqual(4, findRightmostPositionDescending(sortedList, 'ñ'), 'target ñ should insert at position 4');
        assertEqual(5, findRightmostPositionDescending(sortedList, 'n'), 'target n should insert at position 5');
        assertEqual(6, findRightmostPositionDescending(sortedList, 'm'), 'target m should insert at position 6');
        assertEqual(7, findRightmostPositionDescending(sortedList, 'Banana'), 'target Banana should insert at position 7');
        assertEqual(8, findRightmostPositionDescending(sortedList, 'apple'), 'target apple should insert at position 8');
        assertEqual(9, findRightmostPositionDescending(sortedList, 'a'), 'target a should insert at position 9');
        assertEqual(10, findRightmostPositionDescending(sortedList, '2'), 'target 2 should insert at position 10');
        assertEqual(11, findRightmostPositionDescending(sortedList, '10'), 'target 10 should insert at position 11');
        assertEqual(12, findRightmostPositionDescending(sortedList, '1'), 'target 1 should insert at position 12');
        assertEqual(12, findRightmostPositionDescending(sortedList, ALPHA), 'target ALPHA should insert at position 12');

        // Test insertion between existing elements
        assertEqual(8, findRightmostPositionDescending(sortedList, 'A'), 'target A should insert at position 8');
        assertEqual(10, findRightmostPositionDescending(sortedList, '11'), 'target 11 should insert at position 10');
        assertEqual(12, findRightmostPositionDescending(sortedList, '0'), 'target 0 should insert at position 12');
        assertEqual(12, findRightmostPositionDescending(sortedList, '~'), 'target ~ should insert at position 12');
    });

    it('handles empty arrays', () => {
        const sortedList = [];

        assertEqual(0, findRightmostPositionDescending(sortedList, 'a'), 'target should insert at position 0 in empty array');
        assertEqual(0, findRightmostPositionDescending(sortedList, 'z'), 'target should insert at position 0 in empty array');
    });

    it('handles single item arrays', () => {
        const sortedList = [{ key: 'm' }];

        assertEqual(1, findRightmostPositionDescending(sortedList, 'a'), 'target a should insert at position 1');
        assertEqual(1, findRightmostPositionDescending(sortedList, 'm'), 'target m should insert at position 1');
        assertEqual(0, findRightmostPositionDescending(sortedList, 'z'), 'target z should insert at position 0');
    });

    it('handles duplicate keys correctly', () => {
        const sortedList = [
            { key: 'c' },
            { key: 'b' },
            { key: 'b' },
            { key: 'b' },
            { key: 'a' },
        ];

        assertEqual(5, findRightmostPositionDescending(sortedList, 'a'), 'target a should insert at position 5');
        assertEqual(4, findRightmostPositionDescending(sortedList, 'b'), 'target b should insert at rightmost position 4');
        assertEqual(1, findRightmostPositionDescending(sortedList, 'c'), 'target c should insert at position 1');
        assertEqual(0, findRightmostPositionDescending(sortedList, 'd'), 'target d should insert at position 0');
    });
});

describe('binary-search, getAscendingIndexRange', ({ it }) => {
    const items = [
        { key: '1', value: 'one' },
        { key: '10', value: 'ten' },
        { key: '2', value: 'two' },
        { key: 'a', value: 'a' },
        { key: 'apple', value: 'apple' },
        { key: 'banana', value: 'banana' },
        { key: 'Banana', value: 'Banana' },
        { key: 'm', value: 'middle' },
        { key: 'n', value: 'n' },
        { key: 'ñ', value: 'n-tilde' },
        { key: 'o', value: 'o' },
        { key: 'z', value: 'last' },
        { key: 'Zebra', value: 'zebra' },
    ];

    items.sort(sortIndexListAscending);

    it('fetches every item in the list with ALPHA, OMEGA', () => {
        const result = getAscendingIndexRange(items, ALPHA, OMEGA);
        assertEqual(items.length, result.length);
        assertEqual('1', items[0].key);
        assertEqual('Zebra', items[12].key);
    });

    it('fetches the first item in the range inclusively', () => {
        const result = getAscendingIndexRange(items, 'm', OMEGA);
        assertEqual('m', result[0].key);
    });

    it('fetches the last item in the range inclusively', () => {
        const result = getAscendingIndexRange(items, ALPHA, 'm');
        assertEqual('m', result[result.length - 1].key);
    });

    it('fetches expected range', () => {
        const result = getAscendingIndexRange(items, `a${ ALPHA }`, 'b');
        assertEqual(2, result.length);
        assertEqual('a', result[0].key);
        assertEqual('apple', result[1].key);
    });

    it('can fetch a single key', () => {
        const result = getAscendingIndexRange(items, 'a', 'a');
        assertEqual(1, result.length);
        assertEqual('a', result[0].key);
    });
});

describe('binary-search, getDescendingIndexRange', ({ it }) => {
    const items = [
        { key: 'Zebra', value: 'zebra' },
        { key: 'z', value: 'last' },
        { key: 'o', value: 'o' },
        { key: 'ñ', value: 'n-tilde' },
        { key: 'n', value: 'n' },
        { key: 'm', value: 'middle' },
        { key: 'Banana', value: 'Banana' },
        { key: 'banana', value: 'banana' },
        { key: 'apple', value: 'apple' },
        { key: 'a', value: 'a' },
        { key: '2', value: 'two' },
        { key: '10', value: 'ten' },
        { key: '1', value: 'one' },
    ];

    items.sort(sortIndexListDescending);

    it('fetches every item in the list with ALPHA, OMEGA', () => {
        const result = getDescendingIndexRange(items, OMEGA, ALPHA);
        assertEqual(items.length, result.length);
        assertEqual('Zebra', items[0].key);
        assertEqual('1', items[12].key);
    });

    it('fetches the first item in the range inclusively', () => {
        const result = getDescendingIndexRange(items, 'm', ALPHA);
        assertEqual('m', result[0].key);
    });

    it('fetches the last item in the range inclusively', () => {
        const result = getDescendingIndexRange(items, OMEGA, 'm');
        assertEqual('m', result[result.length - 1].key);
    });

    it('fetches expected range', () => {
        const result = getDescendingIndexRange(items, 'b', `a${ ALPHA }`);
        assertEqual(2, result.length);
        assertEqual('apple', result[0].key);
        assertEqual('a', result[1].key);
    });

    it('can fetch a single key', () => {
        const result = getDescendingIndexRange(items, 'a', 'a');
        assertEqual(1, result.length);
        assertEqual('a', result[0].key);
    });
});


