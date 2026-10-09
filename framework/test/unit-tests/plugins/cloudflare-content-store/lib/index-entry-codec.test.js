import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { decodeStorageRow, encodeStorageRow } from '../../../../../src/plugins/cloudflare-content-store/lib/index-entry-codec.js';
import ContentAddressableIndex from '../../../../../src/kixx/content-addressable-store/content-addressable-index.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

// The shape the index SQL query returns: every column present, with a tree
// storing null in the two columns only a blob uses.
function makeTreeRow(overrides) {
    return { kind: 'tree', hash: 'tree-hash', size: null, metadata: null, ...overrides };
}

function makeBlobRow(overrides) {
    return { kind: 'blob', hash: 'blob-hash', size: 12, metadata: null, ...overrides };
}

describe('index-entry-codec', ({ describe }) => {

    describe('encodeStorageRow()', ({ it }) => {
        it('flattens a tree tuple, leaving the blob-only columns null', () => {
            const row = encodeStorageRow('/dir', [ 'tree', 'tree-hash' ]);

            assertEqual('tree', row.kind);
            assertEqual('tree-hash', row.hash);
            assertEqual(null, row.size);
            assertEqual(null, row.metadata);
        });

        it('flattens a blob tuple, serializing its metadata as JSON', () => {
            const row = encodeStorageRow('/a.txt', [ 'blob', 'blob-hash', 12, { contentType: 'text/plain' } ]);

            assertEqual('blob', row.kind);
            assertEqual('blob-hash', row.hash);
            assertEqual(12, row.size);
            assertEqual('{"contentType":"text/plain"}', row.metadata);
        });

        it('stores a zero-length blob rather than rejecting it', () => {
            const row = encodeStorageRow('/empty.txt', [ 'blob', 'blob-hash', 0, null ]);

            assertEqual(0, row.size);
        });

        // A tree tuple has exactly two elements, so size and metadata
        // destructure to undefined. Validating them the way a blob's are
        // validated would reject every tree, including the always-present root.
        it('accepts a tree tuple whose size and metadata elements are absent', () => {
            const caught = catchError(() => encodeStorageRow('/', [ 'tree', 'root-hash' ]));

            assertEqual(null, caught);
        });

        it('rejects tuples with extra elements', () => {
            for (const tuple of [
                [ 'tree', 'tree-hash', null ],
                [ 'blob', 'blob-hash', 12, null, null ],
            ]) {
                const caught = catchError(() => encodeStorageRow('/entry', tuple));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
            }
        });

        it('rejects an unrecognized kind', () => {
            const caught = catchError(() => encodeStorageRow('/a.txt', [ 'symlink', 'some-hash' ]));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('/a.txt', caught.message);
            assertMatches('kind', caught.message);
        });

        it('rejects an empty hash, which the NOT NULL column would not catch', () => {
            const caught = catchError(() => encodeStorageRow('/a.txt', [ 'blob', '', 12, null ]));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('/a.txt', caught.message);
        });

        it('rejects a blob with missing tuple elements', () => {
            const caught = catchError(() => encodeStorageRow('/a.txt', [ 'blob', 'blob-hash' ]));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('exactly 4 elements', caught.message);
        });

        it('rejects a negative blob size', () => {
            const caught = catchError(() => encodeStorageRow('/a.txt', [ 'blob', 'blob-hash', -1, null ]));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('size', caught.message);
        });

        it('rejects blob metadata that is not a plain object or null', () => {
            const caught = catchError(() => encodeStorageRow('/a.txt', [ 'blob', 'blob-hash', 12, 'text/plain' ]));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('metadata', caught.message);
        });
    });

    describe('decodeStorageRow()', ({ it }) => {
        it('restores a tree tuple to exactly two elements', () => {
            const tuple = decodeStorageRow(makeTreeRow());

            assertEqual(2, tuple.length);
            assertEqual('tree', tuple[0]);
            assertEqual('tree-hash', tuple[1]);
        });

        it('restores a blob tuple to exactly four elements', () => {
            const tuple = decodeStorageRow(makeBlobRow());

            assertEqual(4, tuple.length);
            assertEqual('blob', tuple[0]);
            assertEqual('blob-hash', tuple[1]);
            assertEqual(12, tuple[2]);
            assertEqual(null, tuple[3]);
        });

        it('parses stored metadata JSON back into an object', () => {
            const tuple = decodeStorageRow(makeBlobRow({ metadata: '{"contentType":"text/plain"}' }));

            assertEqual('text/plain', tuple[3].contentType);
        });

        it('reads an absent metadata column as null rather than a string', () => {
            const tuple = decodeStorageRow(makeBlobRow({ metadata: null }));

            assertEqual(null, tuple[3]);
        });
    });

    describe('the storage round trip', ({ it }) => {
        // The pair exists to preserve what the index requires, so the binding
        // assertion is that a table survives storage and is still accepted.
        it('preserves a table the ContentAddressableIndex accepts', async () => {
            const original = await ContentAddressableIndex.buildIndex([
                { pathname: '/a.txt', hash: 'hash-a', size: 5, metadata: { contentType: 'text/plain' } },
                { pathname: '/dir/b.txt', hash: 'hash-b', size: 7, metadata: null },
            ]);

            const restored = {};
            for (const pathname of Object.keys(original)) {
                const { kind, hash, size, metadata } = encodeStorageRow(pathname, original[pathname]);
                // Bound to the INSERT and read back by the SELECT unchanged.
                restored[pathname] = decodeStorageRow({ kind, hash, size, metadata });
            }

            const index = new ContentAddressableIndex(restored);

            assertEqual(new ContentAddressableIndex(original).rootHash, index.rootHash);
            assertEqual(2, restored['/'].length);
            assertEqual(4, restored['/a.txt'].length);
            assertEqual('text/plain', index.getNode('/a.txt').metadata.contentType);
        });
    });
});
