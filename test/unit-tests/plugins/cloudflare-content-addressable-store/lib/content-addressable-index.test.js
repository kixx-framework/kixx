import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertNotEqual, assertUndefined } from 'kixx-assert';

import ContentAddressableIndex from '../../../../../src/plugins/cloudflare-content-addressable-store/lib/content-addressable-index.js';
import { FORMAT, compareStrings, hashTree } from '../../../../../src/plugins/cloudflare-content-addressable-store/lib/addressing.js';


async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

function makeListingEntries() {
    return {
        '/a.txt': [ 'blob', 'h-a', 1, null ],
        '/dir': [ 'tree', 'h-dir' ],
        '/dir/b.txt': [ 'blob', 'h-b', 2, null ],
        '/dir/sub': [ 'tree', 'h-sub' ],
        '/dir/sub/c.txt': [ 'blob', 'h-c', 3, null ],
        '/dirbar.txt': [ 'blob', 'h-dirbar', 4, null ],
    };
}


describe('ContentAddressableIndex', ({ describe }) => {

    describe('constructor', ({ it }) => {
        it('rejects entries which are not a plain object', () => {
            const caught = catchError(() => new ContentAddressableIndex([]));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('entries must be a plain object', caught.message);
        });

        it('rejects an invalid tree tuple', () => {
            const caught = catchError(() => new ContentAddressableIndex({
                '/dir': [ 'tree', 'hashabc', null, null ],
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('tree tuple must contain exactly 2 elements', caught.message);
        });

        it('rejects an invalid blob tuple', () => {
            const caught = catchError(() => new ContentAddressableIndex({
                '/file.txt': [ 'blob', 'hashabc', -1, null ],
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('blob size must be a non-negative integer or null', caught.message);
        });

        it('rejects malformed tuple fields', () => {
            const invalidTuples = [
                'not-a-tuple',
                [ 'other', 'hashabc' ],
                [ 'tree', '' ],
                [ 'blob', 'hashabc', 1 ],
                [ 'blob', 'hashabc', 1, [] ],
            ];

            for (const tuple of invalidTuples) {
                const caught = catchError(() => new ContentAddressableIndex({
                    '/entry': tuple,
                }));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
            }
        });

        it('takes a private snapshot of entries and metadata', () => {
            const metadata = { attributes: { language: 'en' } };
            const entries = {
                '/file.txt': [ 'blob', 'hashabc', 10, metadata ],
            };
            const index = new ContentAddressableIndex(entries);

            entries['/file.txt'][1] = 'changed-hash';
            metadata.attributes.language = 'fr';
            entries['/other.txt'] = [ 'blob', 'other-hash', 1, null ];

            const node = index.getNode('/file.txt');
            assertEqual('hashabc', node.hash);
            assertEqual('en', node.metadata.attributes.language);
            assertEqual(null, index.getNode('/other.txt'));
            assertUndefined(index.entries);
        });

        it('does not expose metadata which can mutate the index', () => {
            const index = new ContentAddressableIndex({
                '/file.txt': [ 'blob', 'hashabc', 10, { attributes: { language: 'en' } } ],
            });

            const node = index.getNode('/file.txt');
            node.metadata.attributes.language = 'fr';

            assertEqual('en', index.getNode('/file.txt').metadata.attributes.language);
        });
    });

    describe('getNode()', ({ it }) => {
        it('returns the decoded node for an existing pathname', () => {
            const index = new ContentAddressableIndex({
                '/a/b.txt': [ 'blob', 'hash123', 42, { type: 'text' } ],
            });

            const node = index.getNode('/a/b.txt');

            assertEqual('/a/b.txt', node.pathname);
            assertEqual('blob', node.kind);
            assertEqual('hash123', node.hash);
            assertEqual(42, node.size);
            assertEqual('text', node.metadata.type);
        });

        it('decodes a compact tree entry with null size and metadata', () => {
            const index = new ContentAddressableIndex({
                '/a': [ 'tree', 'hashabc' ],
            });

            const node = index.getNode('/a');

            assertEqual('tree', node.kind);
            assertEqual(null, node.size);
            assertEqual(null, node.metadata);
        });

        it('returns null when no entry exists at the pathname', () => {
            const index = new ContentAddressableIndex({});
            assertEqual(null, index.getNode('/missing'));
        });
    });

    describe('listNodes()', ({ it }) => {
        it('lists every node when the prefix is empty', () => {
            const index = new ContentAddressableIndex(makeListingEntries());
            const nodes = index.listNodes('', { recursive: true });
            assertEqual(6, nodes.length);
        });

        it('lists nodes in pathname sort order', () => {
            const index = new ContentAddressableIndex(makeListingEntries());
            const nodes = index.listNodes('', { recursive: true });
            const pathnames = nodes.map((node) => node.pathname);
            const sorted = pathnames.slice().sort(compareStrings);
            assertEqual(sorted.join(','), pathnames.join(','));
        });

        it('recursively lists all nodes nested under a prefix, excluding the directory node itself', () => {
            const index = new ContentAddressableIndex(makeListingEntries());
            const nodes = index.listNodes('/dir', { recursive: true });
            const pathnames = nodes.map((node) => node.pathname).sort(compareStrings);
            assertEqual('/dir/b.txt,/dir/sub,/dir/sub/c.txt', pathnames.join(','));
        });

        it('treats a prefix without a trailing slash the same as one with it', () => {
            const index = new ContentAddressableIndex(makeListingEntries());
            const withSlash = index.listNodes('/dir/', { recursive: true }).map((node) => node.pathname).sort(compareStrings);
            const withoutSlash = index.listNodes('/dir', { recursive: true }).map((node) => node.pathname).sort(compareStrings);
            assertEqual(withSlash.join(','), withoutSlash.join(','));
        });

        it('does not match a different directory that merely shares the prefix text', () => {
            const index = new ContentAddressableIndex(makeListingEntries());
            const pathnames = index.listNodes('/dir', { recursive: true }).map((node) => node.pathname);
            assert(!pathnames.includes('/dirbar.txt'));
        });

        it('lists only immediate children when recursive is false', () => {
            const index = new ContentAddressableIndex(makeListingEntries());
            const nodes = index.listNodes('/dir', { recursive: false });
            const pathnames = nodes.map((node) => node.pathname).sort(compareStrings);
            assertEqual('/dir/b.txt,/dir/sub', pathnames.join(','));
        });

        it('defaults to a recursive listing when options are omitted', () => {
            const index = new ContentAddressableIndex(makeListingEntries());
            const nodes = index.listNodes('/dir');
            const pathnames = nodes.map((node) => node.pathname).sort(compareStrings);
            assertEqual('/dir/b.txt,/dir/sub,/dir/sub/c.txt', pathnames.join(','));
        });

        it('returns an empty array for a prefix with no matching nodes', () => {
            const index = new ContentAddressableIndex(makeListingEntries());
            assertEqual(0, index.listNodes('/missing').length);
        });
    });

    describe('buildIndex()', ({ it }) => {
        it('creates a blob entry for each file, preserving hash, size, and metadata', async () => {
            const entries = await ContentAddressableIndex.buildIndex([
                { pathname: '/a.txt', hash: 'hash-a', size: 10, metadata: { lang: 'en' } },
            ]);
            const index = new ContentAddressableIndex(entries);

            const node = index.getNode('/a.txt');
            assertEqual('blob', node.kind);
            assertEqual('hash-a', node.hash);
            assertEqual(10, node.size);
            assertEqual('en', node.metadata.lang);
        });

        it('defaults a missing size and metadata to null', async () => {
            const entries = await ContentAddressableIndex.buildIndex([
                { pathname: '/a.txt', hash: 'hash-a' },
            ]);
            const index = new ContentAddressableIndex(entries);

            const node = index.getNode('/a.txt');
            assertEqual(null, node.size);
            assertEqual(null, node.metadata);
        });

        it('creates only the root tree entry when given no files', async () => {
            const entries = await ContentAddressableIndex.buildIndex([]);
            assertEqual(1, Object.keys(entries).length);

            const index = new ContentAddressableIndex(entries);
            assertEqual('tree', index.getNode('/').kind);
        });

        it('creates a tree entry for every directory implied by the file pathnames', async () => {
            const entries = await ContentAddressableIndex.buildIndex([
                { pathname: '/dir/sub/file.txt', hash: 'hash-file', size: 1 },
            ]);
            const index = new ContentAddressableIndex(entries);

            assertEqual('tree', index.getNode('/').kind);
            assertEqual('tree', index.getNode('/dir').kind);
            assertEqual('tree', index.getNode('/dir/sub').kind);
            assertEqual('blob', index.getNode('/dir/sub/file.txt').kind);
        });

        it('encodes tree entries as kind and hash tuples', async () => {
            const entries = await ContentAddressableIndex.buildIndex([
                { pathname: '/dir/file.txt', hash: 'hash-file', size: 1 },
            ]);

            assertEqual(2, entries['/'].length);
            assertEqual(2, entries['/dir'].length);
            assertEqual('tree', entries['/dir'][0]);
        });

        it('produces a directory hash independent of file input order', async () => {
            const filesInOrder = [
                { pathname: '/dir/a.txt', hash: 'hash-a', size: 1 },
                { pathname: '/dir/b.txt', hash: 'hash-b', size: 2 },
            ];
            const filesReversed = filesInOrder.slice().reverse();

            const entriesInOrder = await ContentAddressableIndex.buildIndex(filesInOrder);
            const entriesReversed = await ContentAddressableIndex.buildIndex(filesReversed);

            assertEqual(entriesInOrder['/dir'][1], entriesReversed['/dir'][1]);
        });

        it('produces different directory hashes when directory contents differ', async () => {
            const entriesA = await ContentAddressableIndex.buildIndex([
                { pathname: '/dir/a.txt', hash: 'hash-a', size: 1 },
            ]);
            const entriesB = await ContentAddressableIndex.buildIndex([
                { pathname: '/dir/a.txt', hash: 'hash-a2', size: 1 },
            ]);

            assertNotEqual(entriesA['/dir'][1], entriesB['/dir'][1]);
        });

        it('hashes a directory as the tree digest of its sorted, canonicalized children', async () => {
            const entries = await ContentAddressableIndex.buildIndex([
                { pathname: '/dir/a.txt', hash: 'hash-a', size: 1 },
                { pathname: '/dir/b.txt', hash: 'hash-b', size: 2 },
            ]);

            const expectedHash = await hashTree({
                v: FORMAT,
                entries: [
                    { pathname: '/dir/a.txt', kind: 'blob', hash: 'hash-a', size: 1 },
                    { pathname: '/dir/b.txt', kind: 'blob', hash: 'hash-b', size: 2 },
                ],
            });

            assertEqual(expectedHash, entries['/dir'][1]);
        });

        it('throws AssertionError when a file pathname does not start with a slash', async () => {
            const caught = await catchAsyncError(() => ContentAddressableIndex.buildIndex([
                { pathname: 'no-leading-slash.txt', hash: 'hash-a' },
            ]));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('must start with "/"', caught.message);
        });
    });
});
