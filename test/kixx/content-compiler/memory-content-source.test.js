import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { createMemoryContentSource } from '../../../kixx/content-compiler/memory-content-source.js';
import contentSourceConformance from './content-source-conformance.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

describe('memory content source', ({ describe }) => {

    contentSourceConformance(describe, ({ files, symlinks }) => {
        return createMemoryContentSource(files, { symlinks });
    });

    describe('createMemoryContentSource()', ({ it }) => {
        it('takes files without options', async () => {
            const source = createMemoryContentSource({ 'pages/page.json': '{}' });

            const listing = await source.listFiles('pages');

            assertEqual('directory', listing.kind);
            assertEqual('page.json', listing.entries.map((entry) => entry.path).join(','));
        });

        it('copies a Uint8Array, so a later change to it changes no read', async () => {
            const content = new Uint8Array([ 1, 2, 3 ]);
            const source = createMemoryContentSource({ 'public/data.bin': content });

            content.fill(9);

            const bytes = new Uint8Array(await source.readFile('public/data.bin'));

            assertEqual('1,2,3', Array.from(bytes).join(','));
        });

        it('reads only the viewed bytes of a Uint8Array over a larger buffer', async () => {
            const whole = new Uint8Array([ 0, 1, 2, 3, 4, 5 ]);
            const source = createMemoryContentSource({ 'public/data.bin': whole.subarray(2, 4) });

            const buffer = await source.readFile('public/data.bin');

            assertEqual(2, buffer.byteLength);
            assertEqual('2,3', Array.from(new Uint8Array(buffer)).join(','));
        });

        it('resolves null for a path that is a symbolic link', async () => {
            const source = createMemoryContentSource({ 'pages/page.json': '{}' }, { symlinks: [ 'pages/linked.html' ] });

            assertEqual(null, await source.readFile('pages/linked.html'));
        });

        it('requires files to be a plain object', () => {
            for (const files of [ undefined, null, [], new Map(), 'pages/page.json' ]) {
                const caught = catchError(() => createMemoryContentSource(files));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
                assertMatches('files must be a plain object', caught.message);
            }
        });

        it('requires each file to be a string or a Uint8Array', () => {
            for (const content of [ null, 7, {}, [ 1, 2 ], new ArrayBuffer(2) ]) {
                const caught = catchError(() => createMemoryContentSource({ 'pages/page.json': content }));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
                assertMatches('file "pages/page.json" must be a string or a Uint8Array', caught.message);
            }
        });

        it('requires symlinks to be an Array', () => {
            const caught = catchError(() => createMemoryContentSource({}, { symlinks: 'pages/linked' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('options.symlinks must be an Array', caught.message);
        });

        it('refuses a file path that breaks the path rules', () => {
            for (const path of [ '/pages/page.json', 'pages/../page.json', './page.json', 'pages//page.json', 'pages/', '' ]) {
                const caught = catchError(() => createMemoryContentSource({ [path]: '{}' }));

                assert(caught, `expected ${ JSON.stringify(path) } to be refused`);
                assertEqual('AssertionError', caught.name);
                assertMatches('a file path must be a relative POSIX path', caught.message);
            }
        });

        it('refuses a symlink path that breaks the path rules', () => {
            for (const path of [ '/pages/linked', 'pages/../linked', 7 ]) {
                const caught = catchError(() => createMemoryContentSource({}, { symlinks: [ path ] }));

                assert(caught, `expected ${ JSON.stringify(path) } to be refused`);
                assertEqual('AssertionError', caught.name);
                assertMatches('a symlink path must be a relative POSIX path', caught.message);
            }
        });

        it('refuses a path that is both a file and a symbolic link', () => {
            const caught = catchError(() => {
                createMemoryContentSource({ 'pages/page.html': '<p></p>' }, { symlinks: [ 'pages/page.html' ] });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('"pages/page.html" is both a file and a symbolic link', caught.message);
        });

        it('refuses a file beneath a symbolic link', () => {
            const caught = catchError(() => {
                createMemoryContentSource({ 'pages/linked/page.json': '{}' }, { symlinks: [ 'pages/linked' ] });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('"pages/linked/page.json" lies beneath the symbolic link "pages/linked"', caught.message);
        });

        it('refuses a symbolic link beneath a symbolic link', () => {
            const caught = catchError(() => {
                createMemoryContentSource({}, { symlinks: [ 'pages/linked', 'pages/linked/inner' ] });
            });

            assert(caught, 'expected an error to be thrown');
            assertMatches('"pages/linked/inner" lies beneath the symbolic link "pages/linked"', caught.message);
        });

        it('refuses a path that is both a file and a directory', () => {
            const caught = catchError(() => {
                createMemoryContentSource({ 'pages/about': 'a file', 'pages/about/page.json': '{}' });
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
            assertMatches('"pages/about/page.json" lies beneath the file "pages/about"', caught.message);
        });
    });
});
