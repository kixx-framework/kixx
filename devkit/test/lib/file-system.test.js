import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../lib/vendor/kixx-assert/mod.js';
import fileSystem from '../../lib/file-system.js';

describe('file system', ({ after, before, it }) => {
    let directory;

    before(async () => {
        directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-bundler-'));
        await fsp.writeFile(path.join(directory, 'source.js'), 'export default 1;');
        await fsp.mkdir(path.join(directory, 'directory'));
    });

    after(async () => {
        await fsp.rm(directory, { recursive: true, force: true });
    });

    it('reads source as UTF-8 text', async () => {
        const source = await fileSystem.readFile(path.join(directory, 'source.js'));

        assertEqual('export default 1;', source);
    });

    it('reads exact binary file bytes as an ArrayBuffer', async () => {
        const filepath = path.join(directory, 'binary.bin');
        await fsp.writeFile(filepath, Uint8Array.from([ 0, 127, 128, 255 ]));

        const buffer = await fileSystem.readBinaryFile(filepath);

        assert(buffer instanceof ArrayBuffer);
        assertEqual('0,127,128,255', new Uint8Array(buffer).join(','));
    });

    it('reads directory entries with type information', async () => {
        const entries = await fileSystem.readDirectory(directory);
        const source = entries.find(({ name }) => name === 'source.js');
        const childDirectory = entries.find(({ name }) => name === 'directory');

        assert(source.isFile());
        assert(childDirectory.isDirectory());
    });

    it('reads file and directory metadata', async () => {
        const fileStats = await fileSystem.stat(path.join(directory, 'source.js'));
        const directoryStats = await fileSystem.stat(path.join(directory, 'directory'));

        assert(fileStats.isFile());
        assert(directoryStats.isDirectory());
    });

    it('reads symbolic link metadata without following the link', async () => {
        const filepath = path.join(directory, 'source-link.js');
        await fsp.symlink(path.join(directory, 'source.js'), filepath);

        const stats = await fileSystem.lstat(filepath);

        assert(stats.isSymbolicLink());
    });

    it('distinguishes files from directories and absent paths', async () => {
        const isSourceFile = await fileSystem.isFile(path.join(directory, 'source.js'));
        const isDirectory = await fileSystem.isFile(path.join(directory, 'directory'));
        const isMissing = await fileSystem.isFile(path.join(directory, 'missing.js'));

        assertEqual(true, isSourceFile);
        assertEqual(false, isDirectory);
        assertEqual(false, isMissing);
    });

    it('propagates errors other than path absence', async () => {
        const caught = await catchAsyncError(() => fileSystem.isFile('\0'));

        assert(caught, 'expected an error');
        assertEqual('TypeError', caught.name);
    });

    it('writes UTF-8 text, creating a missing parent directory', async () => {
        const filepath = path.join(directory, 'nested', 'deeper', 'written.txt');

        await fileSystem.writeFile(filepath, 'hello, éé');

        const contents = await fsp.readFile(filepath, 'utf8');
        assertEqual('hello, éé', contents);
    });

    it('overwrites an existing file', async () => {
        const filepath = path.join(directory, 'overwrite.txt');

        await fileSystem.writeFile(filepath, 'first');
        await fileSystem.writeFile(filepath, 'second');

        const contents = await fsp.readFile(filepath, 'utf8');
        assertEqual('second', contents);
    });
});

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }

    return null;
}
