
/**
 * @fileoverview Binary search utilities for range queries in sorted arrays
 *
 * This module provides efficient binary search functions for finding insertion
 * points and ranges in sorted arrays, supporting both ascending and descending
 * order with locale-aware string comparison.
 */

/**
 * @typedef {Object} IndexItem
 * @property {string} key - The sortable key for this item
 */

/**
 * Gets a range of items from an ascending sorted array between startKey and endKey (inclusive)
 * @param {IndexItem[]} sortedList - Array sorted in ascending order by key
 * @param {string} startKey - Start key for the range (inclusive)
 * @param {string} endKey - End key for the range (inclusive)
 * @returns {IndexItem[]} Array of items within the range
 *
 * @example
 * const items = [{key: 'a'}, {key: 'c'}, {key: 'e'}, {key: 'g'}];
 * getAscendingIndexRange(items, 'b', 'f'); // Returns [{key: 'c'}, {key: 'e'}]
 */
export function getAscendingIndexRange(sortedList, startKey, endKey) {
    // Binary search finds insertion points, not exact matches
    // This gives us the range boundaries for our slice operation
    const startIndex = findLeftmostPositionAscending(sortedList, startKey);
    const endIndex = findRightmostPositionAscending(sortedList, endKey);

    // Slice is exclusive of endIndex, which gives us inclusive range
    return sortedList.slice(startIndex, endIndex);
}

/**
 * Gets a range of items from a descending sorted array between startKey and endKey (inclusive)
 * @param {IndexItem[]} sortedList - Array sorted in descending order by key
 * @param {string} startKey - Start key for the range (inclusive, should be >= endKey)
 * @param {string} endKey - End key for the range (inclusive, should be <= startKey)
 * @returns {IndexItem[]} Array of items within the range
 *
 * @example
 * const items = [{key: 'g'}, {key: 'e'}, {key: 'c'}, {key: 'a'}];
 * getDescendingIndexRange(items, 'f', 'b'); // Returns [{key: 'e'}, {key: 'c'}]
 */
export function getDescendingIndexRange(sortedList, startKey, endKey) {
    // In descending order, startKey must be >= endKey for valid range
    // This constraint ensures we're searching from higher to lower values
    const startIndex = findLeftmostPositionDescending(sortedList, startKey);
    const endIndex = findRightmostPositionDescending(sortedList, endKey);

    // Same slice logic as ascending - exclusive end gives us proper range
    return sortedList.slice(startIndex, endIndex);
}

/**
 * Finds the leftmost insertion point for a target in an ascending sorted array
 * @param {IndexItem[]} sortedList - Array sorted in ascending order by key
 * @param {string} target - Target key to find insertion point for
 * @returns {number} Index where target should be inserted (first position >= target)
 *
 * @example
 * const items = [{key: 'a'}, {key: 'c'}, {key: 'e'}];
 * findLeftmostPositionAscending(items, 'b'); // Returns 1
 * findLeftmostPositionAscending(items, 'c'); // Returns 1
 */
export function findLeftmostPositionAscending(sortedList, target) {
    let left = 0;
    let right = sortedList.length;

    // Binary search invariant: left <= answer <= right
    // We're looking for the first position where target can be inserted
    while (left < right) {
        const mid = Math.floor((left + right) / 2);

        // Search right if current element < target (maintains invariant)
        if (isLessThan(sortedList[mid].key, target)) {
            left = mid + 1;
        } else {
            // Current element >= target, so answer is at or before mid
            right = mid;
        }
    }
    return left;
}

/**
 * Finds the rightmost insertion point for a target in an ascending sorted array
 * @param {IndexItem[]} sortedList - Array sorted in ascending order by key
 * @param {string} target - Target key to find insertion point for
 * @returns {number} Index where target should be inserted (first position > target)
 *
 * @example
 * const items = [{key: 'a'}, {key: 'c'}, {key: 'e'}];
 * findRightmostPositionAscending(items, 'c'); // Returns 2
 * findRightmostPositionAscending(items, 'd'); // Returns 2
 */
export function findRightmostPositionAscending(sortedList, target) {
    let left = 0;
    let right = sortedList.length;

    // Same invariant as leftmost search, but we want the first position > target
    while (left < right) {
        const mid = Math.floor((left + right) / 2);

        // Search right if current element <= target (maintains invariant)
        if (isLessThanOrEqualTo(sortedList[mid].key, target)) {
            left = mid + 1;
        } else {
            // Current element > target, so answer is at or before mid
            right = mid;
        }
    }

    // When left == right, we've found the rightmost insertion point
    return left;
}

/**
 * Finds the leftmost insertion point for a target in a descending sorted array
 * @param {IndexItem[]} sortedList - Array sorted in descending order by key
 * @param {string} target - Target key to find insertion point for
 * @returns {number} Index where target should be inserted (first position >= target)
 *
 * @example
 * const items = [{key: 'e'}, {key: 'c'}, {key: 'a'}];
 * findLeftmostPositionDescending(items, 'd'); // Returns 1
 * findLeftmostPositionDescending(items, 'c'); // Returns 1
 */
export function findLeftmostPositionDescending(sortedList, target) {
    let left = 0;
    let right = sortedList.length;

    // For descending order, we flip the comparison logic
    // We want the first position where target can be inserted (>= target)
    while (left < right) {
        const mid = Math.floor((left + right) / 2);

        // Search right if current element > target (descending order invariant)
        if (isGreaterThan(sortedList[mid].key, target)) {
            left = mid + 1;
        } else {
            // Current element <= target, so answer is at or before mid
            right = mid;
        }
    }

    return left;
}

/**
 * Finds the rightmost insertion point for a target in a descending sorted array
 * @param {IndexItem[]} sortedList - Array sorted in descending order by key
 * @param {string} target - Target key to find insertion point for
 * @returns {number} Index where target should be inserted (first position < target)
 *
 * @example
 * const items = [{key: 'e'}, {key: 'c'}, {key: 'a'}];
 * findRightmostPositionDescending(items, 'c'); // Returns 2
 * findRightmostPositionDescending(items, 'b'); // Returns 2
 */
export function findRightmostPositionDescending(sortedList, target) {
    let left = 0;
    let right = sortedList.length;

    // For descending order rightmost search, we want first position < target
    while (left < right) {
        const mid = Math.floor((left + right) / 2);

        // Search right if current element >= target (descending order invariant)
        if (isGreaterThanOrEqualTo(sortedList[mid].key, target)) {
            left = mid + 1;
        } else {
            // Current element < target, so answer is at or before mid
            right = mid;
        }
    }

    return left;
}


/**
 * Comparator function for sorting index items in ascending order by key
 * @param {IndexItem} a - First item to compare
 * @param {IndexItem} b - Second item to compare
 * @returns {number} Negative if a.key < b.key, positive if a.key > b.key, zero if equal
 *
 * @example
 * const items = [{key: 'z'}, {key: 'a'}, {key: 'm'}];
 * items.sort(sortIndexListAscending);
 * // Result: [{key: 'a'}, {key: 'm'}, {key: 'z'}]
 */
export function sortIndexListAscending(a, b) {
    return compare(a.key, b.key);
}

/**
 * Comparator function for sorting index items in descending order by key
 * @param {IndexItem} a - First item to compare
 * @param {IndexItem} b - Second item to compare
 * @returns {number} Positive if a.key < b.key, negative if a.key > b.key, zero if equal
 *
 * @example
 * const items = [{key: 'a'}, {key: 'z'}, {key: 'm'}];
 * items.sort(sortIndexListDescending);
 * // Result: [{key: 'z'}, {key: 'm'}, {key: 'a'}]
 */
export function sortIndexListDescending(a, b) {
    return compare(b.key, a.key);
}

/**
 * Tests if a value is greater than another value using locale-aware comparison
 * @param {*} comp - Value to compare
 * @param {*} val - Value to compare against
 * @returns {boolean} True if comp > val using locale-aware comparison for strings
 *
 * @example
 * isGreaterThan('z', 'a'); // Returns true
 * isGreaterThan('10', '2'); // Returns false (lexical comparison)
 */
export function isGreaterThan(comp, val) {
    return compare(comp, val) > 0;
}

/**
 * Tests if a value is greater than or equal to another value using locale-aware comparison
 * @param {*} comp - Value to compare
 * @param {*} val - Value to compare against
 * @returns {boolean} True if comp >= val using locale-aware comparison for strings
 *
 * @example
 * isGreaterThanOrEqualTo('z', 'a'); // Returns true
 * isGreaterThanOrEqualTo('a', 'a'); // Returns true
 */
export function isGreaterThanOrEqualTo(comp, val) {
    return compare(comp, val) >= 0;
}

/**
 * Tests if a value is less than another value using locale-aware comparison
 * @param {*} comp - Value to compare
 * @param {*} val - Value to compare against
 * @returns {boolean} True if comp < val using locale-aware comparison for strings
 *
 * @example
 * isLessThan('a', 'z'); // Returns true
 * isLessThan('2', '10'); // Returns false (lexical comparison)
 */
export function isLessThan(comp, val) {
    return compare(comp, val) < 0;
}

/**
 * Tests if a value is less than or equal to another value using locale-aware comparison
 * @param {*} comp - Value to compare
 * @param {*} val - Value to compare against
 * @returns {boolean} True if comp <= val using locale-aware comparison for strings
 *
 * @example
 * isLessThanOrEqualTo('a', 'z'); // Returns true
 * isLessThanOrEqualTo('a', 'a'); // Returns true
 */
export function isLessThanOrEqualTo(comp, val) {
    return compare(comp, val) <= 0;
}

/**
 * Compares two values with special handling for strings
 *
 * @param {*} a - First value
 * @param {*} b - Second value
 * @returns {number} -1 if a < b, 1 if a > b, 0 if equal
 * @throws {TypeError} When string values cannot be compared due to locale issues
 *
 * @example
 * // String comparison uses locale-aware sorting
 * compare('ñ', 'n'); // Returns positive number (ñ comes after n)
 * compare('10', '2'); // Returns negative number (lexical comparison)
 *
 * @example
 * // Non-string comparison uses standard operators
 * compare(10, 2); // Returns 1
 * compare(new Date(2023, 0, 1), new Date(2023, 0, 2)); // Returns -1
 */
function compare(a, b) {
    // Use localeCompare for strings to handle international characters correctly
    // For non-strings, fall back to standard comparison operators
    if (typeof a === 'string') {
        return a.localeCompare(b);
    } else if (a < b) {
        return -1;
    } else if (a > b) {
        return 1;
    }
    return 0;
}
