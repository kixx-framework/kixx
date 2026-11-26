import { assert, assertEqual } from '../../../kixx/assertions/mod.js';


/**
 * @typedef {import('../../../kixx/content-compiler/content-source-interface.js').ContentSourceInterface} ContentSourceInterface
 */

/**
 * @typedef {Object} ContentSourceTree
 * @property {Object<string, (string|Uint8Array)>} files - File content by path from the source's root. A string is its UTF-8 bytes.
 * @property {string[]} [symlinks] - Paths that are symbolic links. An implementation over a real file system points each at something that exists, so a source that followed it would list or read it.
 */

/**
 * @callback MakeContentSource
 * @param {ContentSourceTree} tree
 * @returns {Promise<ContentSourceInterface>|ContentSourceInterface} A source holding exactly that tree.
 */

/**
 * The shared content-source contract suite, run against every implementation.
 *
 * It covers only what the port promises everywhere. What an implementation
 * does with its own backing store, and the wording of its error messages,
 * belong in the implementation's own test file.
 *
 * It follows the rules for a suite that may run inside a server: relative
 * imports only, `describe` and `it` only, and the factory called inside each
 * test. Before you change it, read "Shared Conformance Suites" in
 * `test/README.md`.
 *
 * @param {Function} describe - Nested `describe` handle from the enclosing block.
 * @param {MakeContentSource} makeContentSource - Builds the source under test. Called once per test.
 */
export default function contentSourceConformance(describe, makeContentSource) {

    describe('contract: listFiles()', ({ it }) => {
        it('lists every file beneath a directory, with paths relative to it', async () => {
            const source = await makeContentSource({
                files: {
                    'pages/page.json': '{}',
                    'pages/about/page.json': '{}',
                    'pages/about/team/page.html': '<p>Team</p>',
                    'templates/base/main.html': '<html></html>',
                    'readme.txt': 'Not under pages.',
                },
            });

            const listing = await source.listFiles('pages');

            assertEqual('directory', listing.kind);
            assertEqual(
                'file:about/page.json | file:about/team/page.html | file:page.json',
                describeEntries(listing),
            );
        });

        it('lists a nested directory relative to itself', async () => {
            const source = await makeContentSource({
                files: {
                    'templates/partials/nav.html': '<nav></nav>',
                    'templates/partials/admin/notice.html': '<p></p>',
                    'templates/base/main.html': '<html></html>',
                },
            });

            const listing = await source.listFiles('templates/partials');

            assertEqual('directory', listing.kind);
            assertEqual('file:admin/notice.html | file:nav.html', describeEntries(listing));
        });

        it('does not match a directory by a prefix of its name', async () => {
            const source = await makeContentSource({
                files: {
                    'pages/page.json': '{}',
                    'pages-old/page.json': '{}',
                },
            });

            const listing = await source.listFiles('pages');

            assertEqual('file:page.json', describeEntries(listing));
        });

        it('answers "missing" for a directory that does not exist', async () => {
            const source = await makeContentSource({ files: { 'pages/page.json': '{}' } });

            const listing = await source.listFiles('static-assets');

            assertEqual('missing', listing.kind);
            assertEqual(0, listing.entries.length);
        });

        it('answers "missing" for a path that is a file', async () => {
            const source = await makeContentSource({ files: { 'pages/page.json': '{}' } });

            const listing = await source.listFiles('pages/page.json');

            assertEqual('missing', listing.kind);
            assertEqual(0, listing.entries.length);
        });

        it('answers "symlink" for a directory that is a symbolic link, and lists nothing', async () => {
            const source = await makeContentSource({
                files: { 'pages/page.json': '{}' },
                symlinks: [ 'templates' ],
            });

            const listing = await source.listFiles('templates');

            assertEqual('symlink', listing.kind);
            assertEqual(0, listing.entries.length);
        });

        it('lists a linked file and a linked directory as symlink entries, without following either', async () => {
            const source = await makeContentSource({
                files: {
                    'pages/page.json': '{}',
                    'pages/about/page.json': '{}',
                },
                symlinks: [ 'pages/linked.html', 'pages/about/linked' ],
            });

            const listing = await source.listFiles('pages');

            assertEqual('directory', listing.kind);
            assertEqual(
                'file:about/page.json | file:page.json | symlink:about/linked | symlink:linked.html',
                describeEntries(listing),
            );
        });
    });

    describe('contract: readFile()', ({ it }) => {
        it('resolves the exact bytes of a text file', async () => {
            const text = '<p>Héllo, wörld 👋</p>\r\n';
            const source = await makeContentSource({ files: { 'pages/about/page.html': text } });

            const buffer = await source.readFile('pages/about/page.html');

            assert(buffer instanceof ArrayBuffer, 'expected an ArrayBuffer');
            assertEqual(listBytes(new TextEncoder().encode(text)), listBytes(new Uint8Array(buffer)));
        });

        it('keeps a byte order mark', async () => {
            const source = await makeContentSource({ files: { 'pages/page.json': '﻿{}' } });

            const bytes = new Uint8Array(await source.readFile('pages/page.json'));

            assertEqual('239,187,191,123,125', listBytes(bytes));
        });

        it('resolves the exact bytes of a binary file holding every byte value', async () => {
            const content = new Uint8Array(256);

            for (let index = 0; index < content.length; index += 1) {
                content[index] = index;
            }

            const source = await makeContentSource({ files: { 'public/every-byte.bin': content } });

            const buffer = await source.readFile('public/every-byte.bin');

            assertEqual(256, buffer.byteLength);
            assertEqual(listBytes(content), listBytes(new Uint8Array(buffer)));
        });

        it('resolves an empty buffer for an empty file', async () => {
            const source = await makeContentSource({ files: { 'public/empty.txt': '' } });

            const buffer = await source.readFile('public/empty.txt');

            assert(buffer instanceof ArrayBuffer, 'expected an ArrayBuffer');
            assertEqual(0, buffer.byteLength);
        });

        it('resolves null for a file that does not exist', async () => {
            const source = await makeContentSource({ files: { 'pages/page.json': '{}' } });

            assertEqual(null, await source.readFile('pages/missing.json'));
            assertEqual(null, await source.readFile('nowhere/page.json'));
        });

        it('resolves null for a path beneath a file', async () => {
            const source = await makeContentSource({ files: { 'pages/page.json': '{}' } });

            assertEqual(null, await source.readFile('pages/page.json/more'));
        });

        it('resolves null for a directory', async () => {
            const source = await makeContentSource({ files: { 'pages/about/page.json': '{}' } });

            assertEqual(null, await source.readFile('pages'));
            assertEqual(null, await source.readFile('pages/about'));
        });

        it('returns a buffer the caller owns', async () => {
            const source = await makeContentSource({ files: { 'pages/page.json': '{"a":1}' } });

            const first = await source.readFile('pages/page.json');
            new Uint8Array(first).fill(0);

            const second = await source.readFile('pages/page.json');

            assert(first !== second, 'expected a new buffer for each read');
            assertEqual('{"a":1}', new TextDecoder().decode(second));
        });
    });

    describe('contract: paths', ({ it }) => {
        const INVALID_PATHS = [
            [ 'an absolute path', '/pages' ],
            [ 'a ".." segment', 'pages/../secrets' ],
            [ 'a leading ".." segment', '../outside' ],
            [ 'a "." segment', './pages' ],
            [ 'an empty segment', 'pages//about' ],
            [ 'an empty path', '' ],
        ];

        for (const [ label, path ] of INVALID_PATHS) {
            it(`refuses ${ label }`, async () => {
                const source = await makeContentSource({ files: { 'pages/page.json': '{}' } });

                const listError = await catchRejection(() => source.listFiles(path));
                const readError = await catchRejection(() => source.readFile(path));

                assert(listError, `expected listFiles(${ JSON.stringify(path) }) to reject`);
                assert(readError, `expected readFile(${ JSON.stringify(path) }) to reject`);
                assertEqual('AssertionError', listError.name);
                assertEqual('AssertionError', readError.name);
            });
        }
    });
}

// An implementation may list in any order, so every comparison sorts first.
function describeEntries(listing) {
    return listing.entries.map((entry) => `${ entry.type }:${ entry.path }`).sort().join(' | ');
}

function listBytes(bytes) {
    return Array.from(bytes).join(',');
}

// A method that throws before it returns a promise counts as a rejection.
async function catchRejection(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
