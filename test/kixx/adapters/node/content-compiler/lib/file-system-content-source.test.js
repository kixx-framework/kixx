import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import { createFileSystemContentSource } from '../../../../../../kixx/adapters/node/content-compiler/lib/file-system-content-source.js';
import contentSourceConformance from '../../../../content-compiler/content-source-conformance.js';


async function catchRejection(promise) {
    try {
        await promise;
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

describe('node file system content source', ({ before, after, describe }) => {
    let tempDirectory;
    let treeCount = 0;

    // One temporary directory for the whole file. Each tree gets its own
    // subdirectory, so no test sees another's files.
    before(async () => {
        tempDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-content-source-'));
    });

    after(async () => {
        await fsp.rm(tempDirectory, { recursive: true, force: true });
    });

    // Writes a tree to disk and resolves its root directory. Each symbolic
    // link points at something real outside the root, which holds a file a
    // source that followed the link would list or read. A link whose name has
    // an extension points at a file, and any other at a directory.
    async function writeTree({ files, symlinks = [] }) {
        treeCount += 1;

        const treeDirectory = path.join(tempDirectory, `tree-${ treeCount }`);
        const rootDirectory = path.join(treeDirectory, 'root');
        const targetFile = path.join(treeDirectory, 'targets', 'target.html');
        const targetDirectory = path.join(treeDirectory, 'targets', 'directory');

        await fsp.mkdir(rootDirectory, { recursive: true });
        await fsp.mkdir(targetDirectory, { recursive: true });
        await fsp.writeFile(targetFile, '<p>A link target.</p>');
        await fsp.writeFile(path.join(targetDirectory, 'inside.html'), '<p>Inside a linked directory.</p>');

        for (const [ relativePath, content ] of Object.entries(files)) {
            const filepath = path.join(rootDirectory, ...relativePath.split('/'));

            await fsp.mkdir(path.dirname(filepath), { recursive: true });
            await fsp.writeFile(filepath, content);
        }

        for (const relativePath of symlinks) {
            const linkPath = path.join(rootDirectory, ...relativePath.split('/'));
            const isFileLink = path.extname(relativePath) !== '';

            await fsp.mkdir(path.dirname(linkPath), { recursive: true });
            await fsp.symlink(isFileLink ? targetFile : targetDirectory, linkPath);
        }

        return rootDirectory;
    }

    contentSourceConformance(describe, async (tree) => {
        return createFileSystemContentSource(await writeTree(tree));
    });

    describe('createFileSystemContentSource()', ({ it }) => {
        it('requires a root directory', () => {
            for (const rootDirectory of [ undefined, null, '', 7 ]) {
                const caught = catchError(() => createFileSystemContentSource(rootDirectory));

                assert(caught, 'expected an error to be thrown');
                assertEqual('AssertionError', caught.name);
                assertMatches('rootDirectory', caught.message);
            }
        });

        it('resolves a relative root against the working directory', async () => {
            const rootDirectory = await writeTree({ files: { 'pages/page.json': '{"relative":true}' } });
            const source = createFileSystemContentSource(path.relative(process.cwd(), rootDirectory));

            const listing = await source.listFiles('pages');
            const buffer = await source.readFile('pages/page.json');

            assertEqual('directory', listing.kind);
            assertEqual('page.json', listing.entries.map((entry) => entry.path).join(','));
            assertEqual('{"relative":true}', new TextDecoder().decode(buffer));
        });
    });

    describe('listFiles()', ({ it }) => {
        it('lists nothing inside a linked directory, although its target holds a file', async () => {
            const rootDirectory = await writeTree({
                files: { 'pages/page.json': '{}' },
                symlinks: [ 'pages/linked' ],
            });
            const source = createFileSystemContentSource(rootDirectory);

            // The link does lead somewhere: the file system itself follows it.
            const followed = await fsp.readdir(path.join(rootDirectory, 'pages', 'linked'));
            assertEqual('inside.html', followed.join(','));

            const listing = await source.listFiles('pages');

            assertEqual(
                'file:page.json | symlink:linked',
                listing.entries.map((entry) => `${ entry.type }:${ entry.path }`).sort().join(' | '),
            );
        });

        it('lists a symbolic link whose target is gone', async () => {
            const rootDirectory = await writeTree({ files: { 'pages/page.json': '{}' } });
            await fsp.symlink(path.join(rootDirectory, 'nowhere'), path.join(rootDirectory, 'pages', 'broken.html'));

            const listing = await createFileSystemContentSource(rootDirectory).listFiles('pages');

            assertEqual(
                'file:page.json | symlink:broken.html',
                listing.entries.map((entry) => `${ entry.type }:${ entry.path }`).sort().join(' | '),
            );
        });

        it('answers "directory" with no entries for an empty directory', async () => {
            const rootDirectory = await writeTree({ files: {} });
            await fsp.mkdir(path.join(rootDirectory, 'pages', 'empty'), { recursive: true });

            const listing = await createFileSystemContentSource(rootDirectory).listFiles('pages');

            assertEqual('directory', listing.kind);
            assertEqual(0, listing.entries.length);
        });

        it('lists a directory removed during the walk as empty, as a checkout does', async () => {
            const rootDirectory = await writeTree({
                files: { 'pages/page.json': '{}', 'pages/blog/page.json': '{}' },
            });
            const blogDirectory = path.join(rootDirectory, 'pages', 'blog');
            const { readdir } = fsp;

            // The parent was listed; the child goes before it is read.
            fsp.readdir = async (directoryPath, options) => {
                if (directoryPath === blogDirectory) {
                    await fsp.rm(blogDirectory, { recursive: true });
                }
                return readdir(directoryPath, options);
            };

            let listing;

            try {
                listing = await createFileSystemContentSource(rootDirectory).listFiles('pages');
            } finally {
                fsp.readdir = readdir;
            }

            assertEqual('directory', listing.kind);
            assertEqual('page.json', listing.entries.map((entry) => entry.path).join(','));
        });

        it('answers "missing" when the root directory does not exist', async () => {
            const source = createFileSystemContentSource(path.join(tempDirectory, 'no-such-root'));

            const listing = await source.listFiles('pages');

            assertEqual('missing', listing.kind);
            assertEqual(null, await source.readFile('pages/page.json'));
        });
    });

    describe('readFile()', ({ it }) => {
        it('rejects with an OperationalError that names the path and keeps the cause', async () => {
            const rootDirectory = await writeTree({ files: { 'pages/page.json': '{}' } });
            const loopPath = path.join(rootDirectory, 'pages', 'loop.html');

            // A link to itself can't be read on any platform, whoever runs
            // the tests.
            await fsp.symlink(loopPath, loopPath);

            const source = createFileSystemContentSource(rootDirectory);
            const caught = await catchRejection(source.readFile('pages/loop.html'));

            assert(caught, 'expected a rejection');
            assertEqual('OperationalError', caught.name);
            assertMatches(loopPath, caught.message);
            assertMatches('ELOOP', caught.message);
            assertEqual('ELOOP', caught.cause.code);
        });

        it('returns a buffer that holds exactly the file\'s bytes', async () => {
            const rootDirectory = await writeTree({ files: { 'public/small.txt': 'tiny' } });

            // A file this small is read into Node's shared Buffer pool.
            const buffer = await createFileSystemContentSource(rootDirectory).readFile('public/small.txt');

            assertEqual(4, buffer.byteLength);
        });
    });
});
