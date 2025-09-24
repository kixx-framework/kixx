/**
 * Finds the range of keys between startKey and endKey (inclusive) in a sorted array
 * @param {string[]} sortedKeys - Sorted array of string keys
 * @param {string} startKey - Start key for the range
 * @param {string} endKey - End key for the range
 * @returns {string[]} - Array of keys within the range
 */
function binarySearchRange(sortedKeys, startKey, endKey) {
    if (!sortedKeys || sortedKeys.length === 0) {
        return [];
    }
    
    // Find the leftmost position where we can insert startKey
    const startIndex = findLeftmostPosition(sortedKeys, startKey);
    
    // Find the rightmost position where we can insert endKey
    const endIndex = findRightmostPosition(sortedKeys, endKey);
    
    // Return the slice between these positions
    return sortedKeys.slice(startIndex, endIndex);
}

/**
 * Binary search to find the leftmost position where target can be inserted
 * (first position >= target)
 */
function findLeftmostPosition(arr, target) {
    let left = 0;
    let right = arr.length;
    
    while (left < right) {
        const mid = Math.floor((left + right) / 2);
        
        if (arr[mid] < target) {
            left = mid + 1;
        } else {
            right = mid;
        }
    }
    
    return left;
}

/**
 * Binary search to find the rightmost position where target can be inserted
 * (first position > target)
 */
function findRightmostPosition(sortedList, target) {
    let left = 0;
    let right = sortedList.length;
    
    while (left < right) {
        const mid = Math.floor((left + right) / 2);
        
        if (sortedList[mid].key <= target) {
            left = mid + 1;
        } else {
            right = mid;
        }
    }
    
    return left;
}


/**
 * Finds the range of keys between startKey and endKey (inclusive) in a sorted array
 * @param {string[]} sortedKeys - Sorted array of string keys
 * @param {string} startKey - Start key for the range
 * @param {string} endKey - End key for the range
 * @returns {string[]} - Array of keys within the range
 */
function binarySearchRange(sortedKeys, startKey, endKey) {
    if (!sortedKeys || sortedKeys.length === 0) {
        return [];
    }
    
    // Find the leftmost position where we can insert startKey
    const startIndex = findLeftmostPosition(sortedKeys, startKey);
    
    // Find the rightmost position where we can insert endKey
    const endIndex = findRightmostPosition(sortedKeys, endKey);
    
    // Return the slice between these positions
    return sortedKeys.slice(startIndex, endIndex);
}

/**
 * Binary search to find the leftmost position where target can be inserted
 * (first position >= target)
 */
function findLeftmostPosition(arr, target) {
    let left = 0;
    let right = arr.length;
    
    while (left < right) {
        const mid = Math.floor((left + right) / 2);
        
        if (arr[mid] < target) {
            left = mid + 1;
        } else {
            right = mid;
        }
    }
    
    return left;
}

/**
 * Binary search to find the rightmost position where target can be inserted
 * (first position > target)
 */
function findRightmostPosition(arr, target) {
    let left = 0;
    let right = arr.length;
    
    while (left < right) {
        const mid = Math.floor((left + right) / 2);
        
        if (arr[mid] <= target) {
            left = mid + 1;
        } else {
            right = mid;
        }
    }
    
    return left;
}

/**
 * Binary search functions for DESCENDING order arrays
 */

/**
 * Binary search to find the leftmost position where target can be inserted
 * in a descending order array (first position >= target)
 */
function findLeftmostPositionDesc(arr, target) {
    let left = 0;
    let right = arr.length;
    
    while (left < right) {
        const mid = Math.floor((left + right) / 2);
        
        if (arr[mid] > target) {
            left = mid + 1;
        } else {
            right = mid;
        }
    }
    
    return left;
}

/**
 * Binary search to find the rightmost position where target can be inserted
 * in a descending order array (first position < target)
 */
function findRightmostPositionDesc(arr, target) {
    let left = 0;
    let right = arr.length;
    
    while (left < right) {
        const mid = Math.floor((left + right) / 2);
        
        if (arr[mid] >= target) {
            left = mid + 1;
        } else {
            right = mid;
        }
    }
    
    return left;
}

/**
 * Binary search range for DESCENDING order arrays
 * @param {string[]} sortedKeysDesc - Sorted array of string keys in descending order
 * @param {string} startKey - Start key for the range (should be >= endKey for desc order)
 * @param {string} endKey - End key for the range (should be <= startKey for desc order)
 * @returns {string[]} - Array of keys within the range
 */
function binarySearchRangeDesc(sortedKeysDesc, startKey, endKey) {
    if (!sortedKeysDesc || sortedKeysDesc.length === 0) {
        return [];
    }
    
    // For descending order, startKey should be >= endKey
    // Find where startKey would be inserted (leftmost position)
    const startIndex = findLeftmostPositionDesc(sortedKeysDesc, startKey);
    
    // Find where endKey would be inserted (rightmost position)
    const endIndex = findRightmostPositionDesc(sortedKeysDesc, endKey);
    
    return sortedKeysDesc.slice(startIndex, endIndex);
}

/**
 * Alternative implementation that returns indices instead of values
 */
function binarySearchRangeIndices(sortedKeys, startKey, endKey) {
    if (!sortedKeys || sortedKeys.length === 0) {
        return { start: -1, end: -1, length: 0 };
    }
    
    const startIndex = findLeftmostPosition(sortedKeys, startKey);
    const endIndex = findRightmostPosition(sortedKeys, endKey);
    
    return {
        start: startIndex < sortedKeys.length ? startIndex : -1,
        end: endIndex > 0 ? endIndex - 1 : -1,
        length: Math.max(0, endIndex - startIndex)
    };
}

/**
 * Generic version that works with both ascending and descending order
 */
function binarySearchRangeGeneric(sortedKeys, startKey, endKey, isDescending = false) {
    if (isDescending) {
        return binarySearchRangeDesc(sortedKeys, startKey, endKey);
    } else {
        return binarySearchRange(sortedKeys, startKey, endKey);
    }
}
