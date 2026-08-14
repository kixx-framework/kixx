import { compareStrings } from './addressable.js';


export default class ContentAddressableIndex {

    #sortedPaths;

    // TODO: We need to set this.files;

    getNode(pathname) {
        const tuple = this.files[pathname];
        return tuple ? decodeIndexEntry(pathname, tuple) : null;
    }

    listNodes(prefix, options) {
        const { recursive = true } = options ?? {};

        // The prefix must end with a slash "/".
        if (prefix !== '' && !prefix.endsWith('/')) {
            prefix = `${ prefix }/`;
        }

        const paths = this.#getSortedPaths();
        const start = lowerBound(paths, prefix);

        const nodes = [];
        for (let i = start; i < paths.length; i += 1) {
            const path = paths[i];
            // Sorted order guarantees every path matching path is contiguous, so the first
            // miss past `start` means there are no more — stop instead of
            // scanning the rest of the index.
            if (prefix !== '' && !path.startsWith(prefix)) {
                break;
            }
            // If a path includes a "/" beyond the scope, then we know it is nested.
            // Paths never end with a slash "/" -- not even directories.
            if (!recursive && path.slice(prefix.length).includes('/')) {
                continue;
            }
            nodes.push(decodeIndexEntry(path, this.files[path]));
        }

        return nodes;
    }

    #getSortedPaths() {
        if (this.#sortedPaths) {
            return this.#sortedPaths;
        }
        this.#sortedPaths = Object.keys(this.files).sort(compareStrings);
        return this.#sortedPaths;
    }
}

function decodeIndexEntry(pathname, tuple) {
    const [ kind, hash, size, metadata ] = tuple;
    return {
        pathname,
        kind,
        hash,
        size,
        metadata,
    };
}

/** First index in `sortedArray` whose value is >= `target`. */
function lowerBound(sortedArray, target) {
    let lo = 0;
    let hi = sortedArray.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (compareStrings(sortedArray[mid], target) < 0) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}
