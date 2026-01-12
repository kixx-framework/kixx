/**
 * Extracts a range of items from an ascending-sorted list between startKey and endKey (inclusive).
 * Uses binary search for O(log n) performance instead of linear scan.
 * 
 * @param {Array<{key: *}>} sortedList - Pre-sorted array of objects with 'key' property
 * @param {*} startKey - Inclusive start of range (can use ALPHA for open start)
 * @param {*} endKey - Inclusive end of range (can use OMEGA for open end)
 * @returns {Array} Subarray containing all items with keys in [startKey, endKey]
 */
export function getAscendingIndexRange(sortedList, startKey, endKey) {
    // Binary search finds insertion points, not exact matches
    // Leftmost position ensures we include all items equal to startKey
    // Rightmost position gives us the first position AFTER endKey
    const startIndex = findLeftmostPositionAscending(sortedList, startKey);
    const endIndex = findRightmostPositionAscending(sortedList, endKey);

    // Slice is exclusive of endIndex, which gives us inclusive range
    // Example: [a, b, c, d], startKey='b', endKey='c'
    //   startIndex=1 (leftmost 'b'), endIndex=3 (first position after 'c')
    //   slice(1, 3) = [b, c] ✓
    return sortedList.slice(startIndex, endIndex);
}

/**
 * Extracts a range of items from a descending-sorted list between startKey and endKey (inclusive).
 * In descending order, startKey should be >= endKey to form a valid range.
 * 
 * @param {Array<{key: *}>} sortedList - Pre-sorted array (descending) of objects with 'key' property
 * @param {*} startKey - Inclusive start of range (higher value, can use OMEGA for open start)
 * @param {*} endKey - Inclusive end of range (lower value, can use ALPHA for open end)
 * @returns {Array} Subarray containing all items with keys in [startKey, endKey] (descending)
 */
export function getDescendingIndexRange(sortedList, startKey, endKey) {
    // In descending order, startKey must be >= endKey for valid range
    // This constraint ensures we're searching from higher to lower values
    // Example: [z, m, a], startKey='m', endKey='a' gives range [m, a]
    const startIndex = findLeftmostPositionDescending(sortedList, startKey);
    const endIndex = findRightmostPositionDescending(sortedList, endKey);

    // Same slice logic as ascending - exclusive end gives us proper range
    // Example: [z, m, a], startKey='m', endKey='a'
    //   startIndex=1 (leftmost 'm'), endIndex=3 (first position after 'a')
    //   slice(1, 3) = [m, a] ✓
    return sortedList.slice(startIndex, endIndex);
}

/**
 * Finds the leftmost insertion point for target in an ascending-sorted list.
 * Returns the index where target should be inserted to maintain sort order,
 * or the index of the first element equal to target if it exists.
 * 
 * This implements a lower_bound-style binary search: O(log n) performance.
 * 
 * @param {Array<{key: *}>} sortedList - Ascending-sorted array of objects with 'key' property
 * @param {*} target - Value to find insertion point for
 * @returns {number} Index where target should be inserted (0 to sortedList.length)
 * 
 * @example
 * // List: [a, b, b, c], target: 'b'
 * // Returns: 1 (leftmost position where 'b' appears)
 */
export function findLeftmostPositionAscending(sortedList, target) {
    let left = 0;
    let right = sortedList.length;

    // Binary search invariant: left <= answer <= right
    // We're looking for the first position where target can be inserted
    // When loop exits, left == right == insertion point
    while (left < right) {
        const mid = Math.floor((left + right) / 2);

        // Search right if current element < target (maintains invariant)
        // We want the first position where element >= target
        if (isLessThan(sortedList[mid].key, target)) {
            left = mid + 1;
        } else {
            // Current element >= target, so answer is at or before mid
            // Narrow search to left half (including mid, since it might be the answer)
            right = mid;
        }
    }
    return left;
}

/**
 * Finds the rightmost insertion point for target in an ascending-sorted list.
 * Returns the index of the first element greater than target, or sortedList.length
 * if all elements are <= target.
 * 
 * This implements an upper_bound-style binary search: O(log n) performance.
 * Used with findLeftmostPositionAscending to create inclusive ranges.
 * 
 * @param {Array<{key: *}>} sortedList - Ascending-sorted array of objects with 'key' property
 * @param {*} target - Value to find insertion point for
 * @returns {number} Index of first element > target (0 to sortedList.length)
 * 
 * @example
 * // List: [a, b, b, c], target: 'b'
 * // Returns: 3 (first position after all 'b' elements)
 */
export function findRightmostPositionAscending(sortedList, target) {
    let left = 0;
    let right = sortedList.length;

    // Same invariant as leftmost search, but we want the first position > target
    // This gives us the exclusive end index for range queries
    while (left < right) {
        const mid = Math.floor((left + right) / 2);

        // Search right if current element <= target (maintains invariant)
        // We want the first position where element > target
        if (isLessThanOrEqualTo(sortedList[mid].key, target)) {
            left = mid + 1;
        } else {
            // Current element > target, so answer is at or before mid
            // Narrow search to left half (including mid, since it might be the answer)
            right = mid;
        }
    }

    // When left == right, we've found the rightmost insertion point
    // This is the exclusive end index: slice(startIndex, endIndex) includes all
    // elements >= startKey and <= endKey
    return left;
}

/**
 * Finds the leftmost insertion point for target in a descending-sorted list.
 * Returns the index where target should be inserted to maintain descending sort order,
 * or the index of the first element equal to target if it exists.
 * 
 * Comparison logic is flipped from ascending: we search for first position where
 * element <= target (since larger values come first in descending order).
 * 
 * @param {Array<{key: *}>} sortedList - Descending-sorted array of objects with 'key' property
 * @param {*} target - Value to find insertion point for
 * @returns {number} Index where target should be inserted (0 to sortedList.length)
 * 
 * @example
 * // List: [z, m, m, a], target: 'm'
 * // Returns: 1 (leftmost position where 'm' appears)
 */
export function findLeftmostPositionDescending(sortedList, target) {
    let left = 0;
    let right = sortedList.length;

    // For descending order, we flip the comparison logic
    // We want the first position where target can be inserted (>= target)
    // In descending order, elements decrease, so we look for first element <= target
    while (left < right) {
        const mid = Math.floor((left + right) / 2);

        // Search right if current element > target (descending order invariant)
        // In descending: [z, m, a], we want first position where element <= target
        if (isGreaterThan(sortedList[mid].key, target)) {
            left = mid + 1;
        } else {
            // Current element <= target, so answer is at or before mid
            // Narrow search to left half (including mid)
            right = mid;
        }
    }

    return left;
}

/**
 * Finds the rightmost insertion point for target in a descending-sorted list.
 * Returns the index of the first element less than target, or sortedList.length
 * if all elements are >= target.
 * 
 * Used with findLeftmostPositionDescending to create inclusive ranges in
 * descending-sorted lists. Comparison logic is flipped from ascending.
 * 
 * @param {Array<{key: *}>} sortedList - Descending-sorted array of objects with 'key' property
 * @param {*} target - Value to find insertion point for
 * @returns {number} Index of first element < target (0 to sortedList.length)
 * 
 * @example
 * // List: [z, m, m, a], target: 'm'
 * // Returns: 3 (first position after all 'm' elements)
 */
export function findRightmostPositionDescending(sortedList, target) {
    let left = 0;
    let right = sortedList.length;

    // For descending order rightmost search, we want first position < target
    // In descending: [z, m, a], we want first position where element < target
    while (left < right) {
        const mid = Math.floor((left + right) / 2);

        // Search right if current element >= target (descending order invariant)
        // We want the first position where element < target
        if (isGreaterThanOrEqualTo(sortedList[mid].key, target)) {
            left = mid + 1;
        } else {
            // Current element < target, so answer is at or before mid
            // Narrow search to left half (including mid)
            right = mid;
        }
    }

    return left;
}


/**
 * Comparator function for sorting index items in ascending order by key.
 * Used with Array.prototype.sort() to maintain sorted order.
 * 
 * @param {{key: *}} a - First index item
 * @param {{key: *}} b - Second index item
 * @returns {number} Negative if a < b, positive if a > b, 0 if equal
 */
export function sortIndexListAscending(a, b) {
    return compare(a.key, b.key);
}

/**
 * Comparator function for sorting index items in descending order by key.
 * Reverses the comparison order to achieve descending sort.
 * 
 * @param {{key: *}} a - First index item
 * @param {{key: *}} b - Second index item
 * @returns {number} Negative if a > b, positive if a < b, 0 if equal
 */
export function sortIndexListDescending(a, b) {
    return compare(b.key, a.key);
}

export function isGreaterThan(comp, val) {
    return compare(comp, val) > 0;
}

export function isGreaterThanOrEqualTo(comp, val) {
    return compare(comp, val) >= 0;
}

export function isLessThan(comp, val) {
    return compare(comp, val) < 0;
}

export function isLessThanOrEqualTo(comp, val) {
    return compare(comp, val) <= 0;
}

/**
 * Core comparison function used by all binary search operations.
 * Handles mixed-type comparisons with special handling for strings.
 * 
 * String comparison uses localeCompare() to properly handle:
 * - International characters (ñ, ö, etc.)
 * - Locale-specific sorting rules
 * - Unicode normalization
 * 
 * Non-string types use standard JavaScript comparison operators.
 * Note: When comparing mixed types (string vs number), strings take precedence
 * and localeCompare will convert the other operand to a string.
 * 
 * @param {*} a - First value to compare
 * @param {*} b - Second value to compare
 * @returns {number} Negative if a < b, positive if a > b, 0 if equal
 * 
 * @example
 * compare('a', 'z') // -1 (a comes before z)
 * compare('ñ', 'n') // 1 (ñ comes after n in locale-aware sort)
 * compare(10, 2) // 1 (10 > 2)
 * compare('10', '2') // -1 (lexical: '1' < '2')
 */
function compare(a, b) {
    // Use localeCompare for strings to handle international characters correctly
    // localeCompare converts non-string b to string if needed, ensuring consistent
    // string-based comparison when first operand is a string
    if (typeof a === 'string') {
        return a.localeCompare(b);
    } else if (a < b) {
        return -1;
    } else if (a > b) {
        return 1;
    }
    return 0;
}
