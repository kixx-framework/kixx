import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertNotEqual, assertUndefined } from 'kixx-assert';

import ContentAddressableIndex, {
    getRootHash,
    assertValidIndexTable,
    validateIndexSourceFiles,
    flattenContentTree,
} from '../../../../src/kixx/content-addressable-store/content-addressable-index.js';
import { FORMAT, compareStrings, hashTree } from '../../../../src/kixx/content-addressable-store/addressing.js';


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
        '/': [ 'tree', 'h-root' ],
        '/a.txt': [ 'blob', 'h-a', 1, null ],
        '/dir': [ 'tree', 'h-dir' ],
        '/dir/b.txt': [ 'blob', 'h-b', 2, null ],
        '/dir/sub': [ 'tree', 'h-sub' ],
        '/dir/sub/c.txt': [ 'blob', 'h-c', 3, null ],
        '/dirbar.txt': [ 'blob', 'h-dirbar', 4, null ],
    };
}


describe('ContentAddressableIndex', ({ describe }) => {

    describe('assertValidIndexTable()', ({ it }) => {
        it('accepts nested plain-object and dense-array metadata unchanged', () => {
            const entries = {
                '/': [ 'tree', 'root-hash' ],
                '/file.txt': [ 'blob', 'blob-hash', 1, {
                    attributes: {
                        languages: [ 'en', 'fr' ],
                    },
                } ],
            };

            assertValidIndexTable(entries);
            assertEqual('fr', entries['/file.txt'][3].attributes.languages[1]);
        });

        it('rejects values which cannot round-trip through JSON faithfully', () => {
            const invalidMetadata = [
                undefined,
                () => {},
                Symbol('metadata'),
                1n,
                NaN,
                Infinity,
                new Date(),
                { toJSON() {} },
            ];

            for (const metadata of invalidMetadata) {
                const caught = catchError(() => assertValidIndexTable({
                    '/': [ 'tree', 'root-hash' ],
                    '/file.txt': [ 'blob', 'blob-hash', 1, { metadata } ],
                }));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
            }
        });

        it('rejects sparse arrays, symbol properties, and cycles', () => {
            const sparse = [ 'first', , 'third' ];
            const withSymbol = { metadata: 'value' };
            withSymbol[Symbol('key')] = 'value';
            const cyclic = {};
            cyclic.self = cyclic;

            for (const metadata of [ sparse, withSymbol, cyclic ]) {
                const caught = catchError(() => assertValidIndexTable({
                    '/': [ 'tree', 'root-hash' ],
                    '/file.txt': [ 'blob', 'blob-hash', 1, metadata ],
                }));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
            }
        });
    });

    describe('constructor', ({ it }) => {
        it('accepts an empty root tree', () => {
            new ContentAddressableIndex({
                '/': [ 'tree', 'root-hash' ],
            });
        });

        it('accepts a complete nested tree', () => {
            new ContentAddressableIndex({
                '/': [ 'tree', 'root-hash' ],
                '/a': [ 'tree', 'a-hash' ],
                '/a/b.txt': [ 'blob', 'blob-hash', 0, null ],
            });
        });

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

        it('rejects invalid blob sizes', () => {
            for (const size of [ null, -1, 1.5, '1' ]) {
                const caught = catchError(() => new ContentAddressableIndex({
                    '/file.txt': [ 'blob', 'hashabc', size, null ],
                }));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
                assertMatches('blob size must be a non-negative integer', caught.message);
            }
        });

        it('accepts a zero-byte blob', () => {
            new ContentAddressableIndex({
                '/': [ 'tree', 'root-hash' ],
                '/empty.txt': [ 'blob', 'blob-hash', 0, null ],
            });
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

        it('rejects pathnames which are unsafe or not canonical', () => {
            const invalidPathnames = [
                'file.txt',
                '/FILE.txt',
                '/dir//file.txt',
                '/dir/',
                '/.hidden',
                '/has space.txt',
            ];

            for (const pathname of invalidPathnames) {
                const caught = catchError(() => new ContentAddressableIndex({
                    '/': [ 'tree', 'root-hash' ],
                    [pathname]: [ 'blob', 'blob-hash', 1, null ],
                }));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
                assertMatches(`entry "${ pathname }" pathname must be safe and canonical`, caught.message);
            }
        });

        it('requires a root entry', () => {
            const caught = catchError(() => new ContentAddressableIndex({
                '/file.txt': [ 'blob', 'blob-hash', 1, null ],
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('entry "/" must be present', caught.message);
        });

        it('requires the root entry to be a tree', () => {
            const caught = catchError(() => new ContentAddressableIndex({
                '/': [ 'blob', 'blob-hash', 1, null ],
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('entry "/" must be a tree', caught.message);
        });

        it('requires every non-root node to have an immediate parent', () => {
            const caught = catchError(() => new ContentAddressableIndex({
                '/': [ 'tree', 'root-hash' ],
                '/a/b.txt': [ 'blob', 'blob-hash', 1, null ],
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('entry "/a/b.txt" parent "/a" must be present', caught.message);
        });

        it('requires every non-root node parent to be a tree', () => {
            const caught = catchError(() => new ContentAddressableIndex({
                '/': [ 'tree', 'root-hash' ],
                '/a': [ 'blob', 'parent-hash', 1, null ],
                '/a/b.txt': [ 'blob', 'blob-hash', 1, null ],
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('entry "/a/b.txt" parent "/a" must be a tree', caught.message);
        });

        it('rejects an empty non-root tree', () => {
            const caught = catchError(() => new ContentAddressableIndex({
                '/': [ 'tree', 'root-hash' ],
                '/empty': [ 'tree', 'empty-hash' ],
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('entry "/empty" tree must contain at least one child', caught.message);
        });

        it('takes a private snapshot of entries and metadata', async () => {
            const metadata = { attributes: { language: 'en' } };
            const entries = {
                '/': [ 'tree', 'root-hash' ],
                '/file.txt': [ 'blob', 'hashabc', 10, metadata ],
            };
            const index = new ContentAddressableIndex(entries);

            entries['/file.txt'][1] = 'changed-hash';
            metadata.attributes.language = 'fr';
            entries['/other.txt'] = [ 'blob', 'other-hash', 1, null ];

            const node = await index.getNode('/file.txt');
            assertEqual('hashabc', node.hash);
            assertEqual('en', node.metadata.attributes.language);
            assertEqual(null, await index.getNode('/other.txt'));
            assertUndefined(index.entries);
        });

        it('does not expose metadata which can mutate the index', async () => {
            const index = new ContentAddressableIndex({
                '/': [ 'tree', 'root-hash' ],
                '/file.txt': [ 'blob', 'hashabc', 10, { attributes: { language: 'en' } } ],
            });

            const node = await index.getNode('/file.txt');
            node.metadata.attributes.language = 'fr';

            assertEqual('en', (await index.getNode('/file.txt')).metadata.attributes.language);
        });
    });

    describe('getNode()', ({ it }) => {
        it('returns the decoded node for an existing pathname', async () => {
            const index = new ContentAddressableIndex({
                '/': [ 'tree', 'root-hash' ],
                '/a': [ 'tree', 'a-hash' ],
                '/a/b.txt': [ 'blob', 'hash123', 42, { type: 'text' } ],
            });

            const node = await index.getNode('/a/b.txt');

            assertEqual('/a/b.txt', node.pathname);
            assertEqual('blob', node.kind);
            assertEqual('hash123', node.hash);
            assertEqual(42, node.size);
            assertEqual('text', node.metadata.type);
        });

        it('decodes a tree node with null size and metadata', async () => {
            const index = new ContentAddressableIndex({
                '/': [ 'tree', 'root-hash' ],
                '/a': [ 'tree', 'hashabc' ],
                '/a/file.txt': [ 'blob', 'blob-hash', 1, null ],
            });

            const node = await index.getNode('/a');

            assertEqual('tree', node.kind);
            assertEqual('hashabc', node.hash);
            // A tree tuple carries no size or metadata slot, and the decoder
            // defaults both to null rather than leaving them undefined.
            assertEqual(null, node.size);
            assertEqual(null, node.metadata);
        });

        it('returns null when no entry exists at the pathname', async () => {
            const index = new ContentAddressableIndex({
                '/': [ 'tree', 'root-hash' ],
            });
            assertEqual(null, await index.getNode('/missing'));
        });
    });

    describe('listNodes()', ({ it }) => {
        it('lists every node when the prefix is empty', async () => {
            const index = new ContentAddressableIndex(makeListingEntries());
            const nodes = await index.listNodes('', { recursive: true });
            assertEqual(7, nodes.length);
        });

        it('lists nodes in pathname sort order', async () => {
            const index = new ContentAddressableIndex(makeListingEntries());
            const nodes = await index.listNodes('', { recursive: true });
            const pathnames = nodes.map((node) => node.pathname);
            const sorted = pathnames.slice().sort(compareStrings);
            assertEqual(sorted.join(','), pathnames.join(','));
        });

        it('decodes the hash of every listed blob and tree', async () => {
            const index = new ContentAddressableIndex(makeListingEntries());
            const nodes = await index.listNodes('/dir', { recursive: false });
            const blob = nodes.find((node) => node.pathname === '/dir/b.txt');
            const tree = nodes.find((node) => node.pathname === '/dir/sub');

            assertEqual('h-b', blob.hash);
            assertEqual('h-sub', tree.hash);
        });

        it('recursively lists all nodes nested under a prefix, excluding the directory node itself', async () => {
            const index = new ContentAddressableIndex(makeListingEntries());
            const nodes = await index.listNodes('/dir', { recursive: true });
            const pathnames = nodes.map((node) => node.pathname).sort(compareStrings);
            assertEqual('/dir/b.txt,/dir/sub,/dir/sub/c.txt', pathnames.join(','));
        });

        it('lists nodes under the root without including the root node itself', async () => {
            const index = new ContentAddressableIndex(makeListingEntries());
            const nodes = await index.listNodes('/', { recursive: true });
            const pathnames = nodes.map((node) => node.pathname).sort(compareStrings);
            assertEqual('/a.txt,/dir,/dir/b.txt,/dir/sub,/dir/sub/c.txt,/dirbar.txt', pathnames.join(','));
        });

        it('treats a prefix without a trailing slash the same as one with it', async () => {
            const index = new ContentAddressableIndex(makeListingEntries());
            const withSlash = (await index.listNodes('/dir/', { recursive: true })).map((node) => node.pathname).sort(compareStrings);
            const withoutSlash = (await index.listNodes('/dir', { recursive: true })).map((node) => node.pathname).sort(compareStrings);
            assertEqual(withSlash.join(','), withoutSlash.join(','));
        });

        it('does not match a different directory that merely shares the prefix text', async () => {
            const index = new ContentAddressableIndex(makeListingEntries());
            const pathnames = (await index.listNodes('/dir', { recursive: true })).map((node) => node.pathname);
            assert(!pathnames.includes('/dirbar.txt'));
        });

        it('lists only immediate children when recursive is false', async () => {
            const index = new ContentAddressableIndex(makeListingEntries());
            const nodes = await index.listNodes('/dir', { recursive: false });
            const pathnames = nodes.map((node) => node.pathname).sort(compareStrings);
            assertEqual('/dir/b.txt,/dir/sub', pathnames.join(','));
        });

        it('defaults to a recursive listing when options are omitted', async () => {
            const index = new ContentAddressableIndex(makeListingEntries());
            const nodes = await index.listNodes('/dir');
            const pathnames = nodes.map((node) => node.pathname).sort(compareStrings);
            assertEqual('/dir/b.txt,/dir/sub,/dir/sub/c.txt', pathnames.join(','));
        });

        it('returns an empty array for a prefix with no matching nodes', async () => {
            const index = new ContentAddressableIndex(makeListingEntries());
            assertEqual(0, (await index.listNodes('/missing')).length);
        });
    });

    describe('buildIndex()', ({ it }) => {
        it('creates a blob entry for each file, preserving hash, size, and metadata', async () => {
            const entries = await ContentAddressableIndex.buildIndex([
                { pathname: '/a.txt', hash: 'hash-a', size: 10, metadata: { lang: 'en' } },
            ]);
            const index = new ContentAddressableIndex(entries);

            const node = await index.getNode('/a.txt');
            assertEqual('blob', node.kind);
            assertEqual('hash-a', node.hash);
            assertEqual(10, node.size);
            assertEqual('en', node.metadata.lang);
        });

        it('defaults missing metadata to null', async () => {
            const entries = await ContentAddressableIndex.buildIndex([
                { pathname: '/a.txt', hash: 'hash-a', size: 1 },
            ]);
            const index = new ContentAddressableIndex(entries);

            const node = await index.getNode('/a.txt');
            assertEqual(1, node.size);
            assertEqual(null, node.metadata);
        });

        it('creates only the root tree entry when given no files', async () => {
            const entries = await ContentAddressableIndex.buildIndex([]);
            assertEqual(1, Object.keys(entries).length);

            const index = new ContentAddressableIndex(entries);
            assertEqual('tree', (await index.getNode('/')).kind);
        });

        it('creates a tree entry for every directory implied by the file pathnames', async () => {
            const entries = await ContentAddressableIndex.buildIndex([
                { pathname: '/dir/sub/file.txt', hash: 'hash-file', size: 1 },
            ]);
            const index = new ContentAddressableIndex(entries);

            assertEqual('tree', (await index.getNode('/')).kind);
            assertEqual('tree', (await index.getNode('/dir')).kind);
            assertEqual('tree', (await index.getNode('/dir/sub')).kind);
            assertEqual('blob', (await index.getNode('/dir/sub/file.txt')).kind);
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

        it('hashes every level of a deep tree from its own sorted children', async () => {
            // Guards the bottom-up hashing in buildIndex(): each tree's digest
            // is derived here, independently, from the algorithm hashDirectory()
            // documents — sorted children, tree children carrying no size, and
            // the metadata key present only where metadata is.
            const entries = await ContentAddressableIndex.buildIndex([
                { pathname: '/a.txt', hash: 'h-a', size: 1 },
                { pathname: '/dir/b.txt', hash: 'h-b', size: 2 },
                { pathname: '/dir/other/f.txt', hash: 'h-f', size: 6 },
                { pathname: '/dir/sub/c.txt', hash: 'h-c', size: 3 },
                { pathname: '/dir/sub/deep/d.txt', hash: 'h-d', size: 4, metadata: { lang: 'en' } },
                { pathname: '/dir/sub/deep/e.txt', hash: 'h-e', size: 5 },
            ]);

            const deepHash = await hashTree({
                v: FORMAT,
                entries: [
                    { pathname: '/dir/sub/deep/d.txt', kind: 'blob', hash: 'h-d', size: 4, metadata: { lang: 'en' } },
                    { pathname: '/dir/sub/deep/e.txt', kind: 'blob', hash: 'h-e', size: 5 },
                ],
            });
            const otherHash = await hashTree({
                v: FORMAT,
                entries: [
                    { pathname: '/dir/other/f.txt', kind: 'blob', hash: 'h-f', size: 6 },
                ],
            });
            const subHash = await hashTree({
                v: FORMAT,
                entries: [
                    { pathname: '/dir/sub/c.txt', kind: 'blob', hash: 'h-c', size: 3 },
                    { pathname: '/dir/sub/deep', kind: 'tree', hash: deepHash },
                ],
            });
            const dirHash = await hashTree({
                v: FORMAT,
                entries: [
                    { pathname: '/dir/b.txt', kind: 'blob', hash: 'h-b', size: 2 },
                    { pathname: '/dir/other', kind: 'tree', hash: otherHash },
                    { pathname: '/dir/sub', kind: 'tree', hash: subHash },
                ],
            });
            const rootHash = await hashTree({
                v: FORMAT,
                entries: [
                    { pathname: '/a.txt', kind: 'blob', hash: 'h-a', size: 1 },
                    { pathname: '/dir', kind: 'tree', hash: dirHash },
                ],
            });

            assertEqual(deepHash, entries['/dir/sub/deep'][1]);
            assertEqual(otherHash, entries['/dir/other'][1]);
            assertEqual(subHash, entries['/dir/sub'][1]);
            assertEqual(dirHash, entries['/dir'][1]);
            assertEqual(rootHash, entries['/'][1]);
        });

        it('hashes a deep tree the same way regardless of file input order', async () => {
            const files = [
                { pathname: '/a.txt', hash: 'h-a', size: 1 },
                { pathname: '/dir/b.txt', hash: 'h-b', size: 2 },
                { pathname: '/dir/other/f.txt', hash: 'h-f', size: 6 },
                { pathname: '/dir/sub/c.txt', hash: 'h-c', size: 3 },
                { pathname: '/dir/sub/deep/d.txt', hash: 'h-d', size: 4 },
            ];

            const inOrder = await ContentAddressableIndex.buildIndex(files);
            const reversed = await ContentAddressableIndex.buildIndex(files.slice().reverse());

            for (const pathname of Object.keys(inOrder)) {
                assertEqual(inOrder[pathname][1], reversed[pathname][1], pathname);
            }
        });

        it('propagates a change at the deepest level up to the root hash', async () => {
            const files = [
                { pathname: '/dir/sub/deep/d.txt', hash: 'h-d', size: 4 },
                { pathname: '/dir/sub/c.txt', hash: 'h-c', size: 3 },
            ];
            const changed = [
                { pathname: '/dir/sub/deep/d.txt', hash: 'h-d2', size: 4 },
                { pathname: '/dir/sub/c.txt', hash: 'h-c', size: 3 },
            ];

            const before = await ContentAddressableIndex.buildIndex(files);
            const after = await ContentAddressableIndex.buildIndex(changed);

            assertNotEqual(before['/dir/sub/deep'][1], after['/dir/sub/deep'][1]);
            assertNotEqual(before['/dir/sub'][1], after['/dir/sub'][1]);
            assertNotEqual(before['/dir'][1], after['/dir'][1]);
            assertNotEqual(before['/'][1], after['/'][1]);
        });

        it('rejects duplicate file pathnames', async () => {
            const caught = await catchAsyncError(() => ContentAddressableIndex.buildIndex([
                { pathname: '/dir/file.txt', hash: 'hash-a', size: 1 },
                { pathname: '/dir/file.txt', hash: 'hash-b', size: 2 },
            ]));

            assert(caught, 'expected an error to be thrown');
            assertEqual('VALIDATION_ERROR', caught.code);
            assertMatches('duplicates pathname "/dir/file.txt"', caught.errors[0].message);
        });

        it('rejects a pathname used as both a blob and a tree regardless of input order', async () => {
            const blob = { pathname: '/a', hash: 'hash-a', size: 1 };
            const child = { pathname: '/a/b.txt', hash: 'hash-b', size: 2 };

            for (const files of [ [ blob, child ], [ child, blob ] ]) {
                const caught = await catchAsyncError(() => ContentAddressableIndex.buildIndex(files));

                assert(caught, 'expected an error to be thrown');
                assertEqual('VALIDATION_ERROR', caught.code);
                assertEqual(1, caught.errors.length);
            }
        });

        it('rejects a file pathname which does not start with a slash', async () => {
            const caught = await catchAsyncError(() => ContentAddressableIndex.buildIndex([
                { pathname: 'no-leading-slash.txt', hash: 'hash-a', size: 1 },
            ]));

            assert(caught, 'expected an error to be thrown');
            assertEqual('VALIDATION_ERROR', caught.code);
            assertMatches('must be a safe, canonical pathname', caught.errors[0].message);
        });
    });

    describe('getRootHash()', ({ it }) => {

        it('returns the root tree hash from an encoded table', () => {
            assertEqual('h-root', getRootHash(makeListingEntries()));
        });

        it('returns the same hash as the index instance accessor', async () => {
            const entries = await ContentAddressableIndex.buildIndex([
                { pathname: '/dir/a.txt', hash: 'hash-a', size: 1 },
            ]);
            const index = new ContentAddressableIndex(entries);

            assertEqual(index.rootHash, getRootHash(entries));
        });

        it('asserts when the table has no root tree entry', () => {
            for (const entries of [ {}, { '/a.txt': [ 'blob', 'h-a', 1, null ] }, { '/': [ 'blob', 'h', 1, null ] } ]) {
                const caught = catchError(() => getRootHash(entries));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
            }
        });
    });

    describe('validateIndexSourceFiles()', ({ it }) => {

        it('accepts a valid file list', () => {
            const caught = catchError(() => validateIndexSourceFiles([
                { pathname: '/a.txt', hash: 'hash-a', size: 0 },
                { pathname: '/dir/b.txt', hash: 'hash-b', size: 2, metadata: { lang: 'en' } },
                { pathname: '/dir/sub/c.txt', hash: 'hash-c', size: 3, metadata: null },
            ]));

            assertEqual(null, caught);
        });

        it('accepts sibling pathnames which share a path prefix', () => {
            const caught = catchError(() => validateIndexSourceFiles([
                { pathname: '/dir/a.txt', hash: 'hash-a', size: 1 },
                { pathname: '/dirbar.txt', hash: 'hash-b', size: 1 },
            ]));

            assertEqual(null, caught);
        });

        it('asserts when the files argument is not an array', () => {
            const caught = catchError(() => validateIndexSourceFiles({ pathname: '/a.txt' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('rejects an entry which is not an object', () => {
            const caught = catchError(() => validateIndexSourceFiles([ 'a.txt' ]));

            assert(caught, 'expected an error to be thrown');
            assertEqual('VALIDATION_ERROR', caught.code);
            assertEqual('files[0] must be an object', caught.errors[0].message);
            assertEqual('files[0]', caught.errors[0].source);
        });

        it('rejects pathnames which are unsafe, not canonical, or not a string', () => {
            const pathnames = [
                'no-leading-slash.txt',
                '/trailing-slash/',
                '/double//slash.txt',
                '/../escape.txt',
                '/.dotfile',
                '/UpperCase.txt',
                '/has space.txt',
                '',
                null,
                12,
            ];

            for (const pathname of pathnames) {
                const caught = catchError(() => validateIndexSourceFiles([
                    { pathname, hash: 'hash-a', size: 1 },
                ]));

                assert(caught, `expected an error to be thrown for ${ pathname }`);
                assertEqual('VALIDATION_ERROR', caught.code);
                assertMatches('must be a safe, canonical pathname', caught.errors[0].message);
                assertEqual('files[0].pathname', caught.errors[0].source);
            }
        });

        it('rejects a file at the root pathname', () => {
            const caught = catchError(() => validateIndexSourceFiles([
                { pathname: '/', hash: 'hash-a', size: 1 },
            ]));

            assert(caught, 'expected an error to be thrown');
            assertEqual('VALIDATION_ERROR', caught.code);
            assertEqual(1, caught.errors.length);
        });

        it('rejects a hash which is not a non-empty string', () => {
            for (const hash of [ undefined, null, '', 12 ]) {
                const caught = catchError(() => validateIndexSourceFiles([
                    { pathname: '/a.txt', hash, size: 1 },
                ]));

                assert(caught, `expected an error to be thrown for ${ hash }`);
                assertEqual('VALIDATION_ERROR', caught.code);
                assertMatches('must be a non-empty string', caught.errors[0].message);
                assertEqual('files[0].hash', caught.errors[0].source);
            }
        });

        it('rejects a size which is not a non-negative integer', () => {
            for (const size of [ undefined, null, -1, 1.5, NaN, '1' ]) {
                const caught = catchError(() => validateIndexSourceFiles([
                    { pathname: '/a.txt', hash: 'hash-a', size },
                ]));

                assert(caught, `expected an error to be thrown for ${ size }`);
                assertEqual('VALIDATION_ERROR', caught.code);
                assertMatches('must be a non-negative integer', caught.errors[0].message);
                assertEqual('files[0].size', caught.errors[0].source);
            }
        });

        it('rejects metadata which is not a plain object, null, or undefined', () => {
            for (const metadata of [ 'meta', 12, [], new Date() ]) {
                const caught = catchError(() => validateIndexSourceFiles([
                    { pathname: '/a.txt', hash: 'hash-a', size: 1, metadata },
                ]));

                assert(caught, `expected an error to be thrown for ${ metadata }`);
                assertEqual('VALIDATION_ERROR', caught.code);
                assertMatches('must be a plain object or null', caught.errors[0].message);
                assertEqual('files[0].metadata', caught.errors[0].source);
            }
        });

        it('rejects a pathname already used as a directory', () => {
            const caught = catchError(() => validateIndexSourceFiles([
                { pathname: '/a/b.txt', hash: 'hash-b', size: 1 },
                { pathname: '/a', hash: 'hash-a', size: 1 },
            ]));

            assert(caught, 'expected an error to be thrown');
            assertEqual('VALIDATION_ERROR', caught.code);
            assertEqual('files[1] pathname "/a" is already used as a directory', caught.errors[0].message);
            assertEqual('files[1]', caught.errors[0].source);
        });

        it('rejects a pathname which nests under an existing file', () => {
            const caught = catchError(() => validateIndexSourceFiles([
                { pathname: '/a', hash: 'hash-a', size: 1 },
                { pathname: '/a/b.txt', hash: 'hash-b', size: 1 },
            ]));

            assert(caught, 'expected an error to be thrown');
            assertEqual('VALIDATION_ERROR', caught.code);
            assertEqual('files[1] pathname "/a/b.txt" nests under file "/a"', caught.errors[0].message);
            assertEqual('files[1]', caught.errors[0].source);
        });

        it('leaves no directory behind for a rejected entry', () => {
            // "/a/b" is rejected for nesting under the file "/a", so it must not
            // register "/a/b" as a directory and make "/a/b/c.txt" look valid.
            const caught = catchError(() => validateIndexSourceFiles([
                { pathname: '/a', hash: 'hash-a', size: 1 },
                { pathname: '/a/b', hash: 'hash-b', size: 1 },
                { pathname: '/a/b/c.txt', hash: 'hash-c', size: 1 },
            ]));

            assert(caught, 'expected an error to be thrown');
            assertEqual(2, caught.errors.length);
            assertEqual('files[1] pathname "/a/b" nests under file "/a"', caught.errors[0].message);
            assertEqual('files[2] pathname "/a/b/c.txt" nests under file "/a"', caught.errors[1].message);
        });

        it('collects every failure before throwing', () => {
            const caught = catchError(() => validateIndexSourceFiles([
                { pathname: '/a.txt', hash: 'hash-a', size: 1 },
                { pathname: 'bad-path.txt', hash: 'hash-b', size: 1 },
                { pathname: '/c.txt', hash: '', size: -1 },
                { pathname: '/a.txt', hash: 'hash-d', size: 1 },
            ]));

            assert(caught, 'expected an error to be thrown');
            assertEqual('VALIDATION_ERROR', caught.code);
            assertEqual(4, caught.errors.length);
            assertEqual(
                'files[1].pathname,files[2].hash,files[2].size,files[3]',
                caught.errors.map(({ source }) => source).join(','),
            );
        });
    });

    describe('flattenContentTree()', ({ it }) => {

        it('returns an empty array for an empty content tree', () => {
            assertEqual(0, flattenContentTree({}).length);
        });

        it('flattens a static asset into its storage pathname', () => {
            const files = flattenContentTree({
                staticAssets: {
                    '/logo.png': { hash: 'hash-logo', size: 10 },
                },
            });

            assertEqual(1, files.length);
            assertEqual('/assets/logo.png', files[0].pathname);
            assertEqual('hash-logo', files[0].hash);
            assertEqual(10, files[0].size);
        });

        it('flattens global template partials into the templates namespace', () => {
            const files = flattenContentTree({
                globalTemplatePartials: { hash: 'hash-partials', size: 1 },
            });

            assertEqual(1, files.length);
            assertEqual('/templates/__template-partials-bundle', files[0].pathname);
        });

        it('flattens base templates into the templates namespace', () => {
            const files = flattenContentTree({
                baseTemplates: { hash: 'hash-base', size: 1 },
            });

            assertEqual(1, files.length);
            assertEqual('/templates/__base-templates-bundle', files[0].pathname);
        });

        it('flattens an email bundle into the emails namespace', () => {
            const files = flattenContentTree({
                emails: {
                    '/welcome': { hash: 'hash-email', size: 1 },
                },
            });

            assertEqual(1, files.length);
            assertEqual('/emails/welcome/__email-assets', files[0].pathname);
        });

        it('flattens each page facet into its own storage pathname', () => {
            const files = flattenContentTree({
                pages: {
                    '/blog/post': {
                        metadata: { hash: 'hash-meta', size: 1 },
                        partials: { hash: 'hash-partials', size: 2 },
                        includes: { hash: 'hash-includes', size: 3 },
                        template: { hash: 'hash-template', size: 4, pathname: '/blog/post/page.html' },
                    },
                },
            });

            const byPathname = new Map(files.map((file) => [ file.pathname, file ]));

            assertEqual(4, files.length);
            assertEqual('hash-meta', byPathname.get('/pages/blog/post/page.json').hash);
            assertEqual('hash-partials', byPathname.get('/pages/blog/post/__page-partials-bundle').hash);
            assertEqual('hash-includes', byPathname.get('/pages/blog/post/__page-includes-bundle').hash);
            assertEqual('hash-template', byPathname.get('/pages/blog/post/page.html').hash);
        });

        it('produces entries only for the page facets which are present', () => {
            const files = flattenContentTree({
                pages: {
                    '/about': {
                        metadata: { hash: 'hash-meta', size: 1 },
                    },
                },
            });

            assertEqual(1, files.length);
            assertEqual('/pages/about/page.json', files[0].pathname);
        });

        it('throws a ValidationError for an invalid staticAssets key', () => {
            const caught = catchError(() => flattenContentTree({
                staticAssets: {
                    'no-leading-slash.png': { hash: 'hash-a', size: 1 },
                },
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('VALIDATION_ERROR', caught.code);
        });

        it('throws a ValidationError for an invalid pages key', () => {
            const caught = catchError(() => flattenContentTree({
                pages: {
                    'no-leading-slash': {
                        metadata: { hash: 'hash-a', size: 1 },
                    },
                },
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('VALIDATION_ERROR', caught.code);
        });

        it('throws a ValidationError for an invalid emails key', () => {
            const caught = catchError(() => flattenContentTree({
                emails: {
                    'no-leading-slash': { hash: 'hash-a', size: 1 },
                },
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('VALIDATION_ERROR', caught.code);
        });

        it('throws a ValidationError for an invalid template pathname', () => {
            const caught = catchError(() => flattenContentTree({
                pages: {
                    '/about': {
                        template: { hash: 'hash-a', size: 1, pathname: 'no-leading-slash.html' },
                    },
                },
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('VALIDATION_ERROR', caught.code);
        });

        it('collects every invalid key across kinds into a single ValidationError', () => {
            const caught = catchError(() => flattenContentTree({
                staticAssets: {
                    'bad-asset.png': { hash: 'hash-a', size: 1 },
                },
                pages: {
                    'bad-page': {
                        metadata: { hash: 'hash-b', size: 1 },
                        template: { hash: 'hash-c', size: 1, pathname: 'bad-template.html' },
                    },
                },
                emails: {
                    'bad-email': { hash: 'hash-d', size: 1 },
                },
            }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('VALIDATION_ERROR', caught.code);
            assertEqual(4, caught.errors.length);
        });

        it('does not validate hash or size shape, deferring that to buildIndex()', () => {
            const caught = catchError(() => flattenContentTree({
                staticAssets: {
                    '/logo.png': { hash: '', size: -1 },
                },
            }));

            assertEqual(null, caught);
        });

        it('passes metadata through unchanged whether omitted, null, or an object', () => {
            const files = flattenContentTree({
                staticAssets: {
                    '/a.png': { hash: 'hash-a', size: 1 },
                    '/b.png': { hash: 'hash-b', size: 1, metadata: null },
                    '/c.png': { hash: 'hash-c', size: 1, metadata: { lang: 'en' } },
                },
            });

            const byPathname = new Map(files.map((file) => [ file.pathname, file ]));

            assertUndefined(byPathname.get('/assets/a.png').metadata);
            assertEqual(null, byPathname.get('/assets/b.png').metadata);
            assertEqual('en', byPathname.get('/assets/c.png').metadata.lang);
        });
    });
});
