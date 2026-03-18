/**
 * Filesystem port conformance tests.
 *
 * Usage in an adapter test file:
 *
 *   import { testFilesystemConformance } from '../../conformance/filesystem.js';
 *
 *   testFilesystemConformance(() => NodeFilesystem);
 *
 * The factory must return a Filesystem-conforming module or object (named functions).
 * It will be called once per describe block.
 *
 * @module conformance/filesystem
 */
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { describe } from 'kixx-test';
import {
    assertEqual,
    assertArray,
    assertBoolean,
    assertDefined,
    assertNonEmptyString,
    assertNumberNotNaN,
    assertValidDate
} from 'kixx-assert';


// A path that is guaranteed not to exist — used for all ENOENT invariant tests.
const NONEXISTENT = path.join(os.tmpdir(), 'kixx-conformance-nonexistent-9999999999999');


/**
 * Registers Filesystem port conformance tests against any adapter implementation.
 *
 * @param {function(): import('../../lib/ports/filesystem.js').Filesystem} createFilesystem
 *   Factory that returns a fresh Filesystem implementation (module namespace or plain object).
 */
export function testFilesystemConformance(createFilesystem) {

    // ──────────────────────────────────────────────────────────────────────────
    // readDirectory()
    // ──────────────────────────────────────────────────────────────────────────

    describe('Filesystem port - readDirectory() with non-existent path must return []', ({ before, it }) => {
        let result;

        before(async () => {
            const filesystem = createFilesystem();
            result = await filesystem.readDirectory(NONEXISTENT);
        });

        it('resolves with an Array', () => assertArray(result));
        it('resolves with an empty Array', () => assertEqual(0, result.length));
    });

    describe('Filesystem port - readDirectory() with an existing directory must return DirEntry objects', ({ before, after, it }) => {
        let tmpDir;
        let result;

        before(async () => {
            tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-fs-test-'));
            await fsp.writeFile(path.join(tmpDir, 'sample.txt'), 'hello');
            const filesystem = createFilesystem();
            result = await filesystem.readDirectory(tmpDir);
        });

        after(async () => {
            await fsp.rm(tmpDir, { recursive: true, force: true });
        });

        it('resolves with an Array', () => assertArray(result));
        it('resolves with one entry', () => assertEqual(1, result.length));
        it('entry has a non-empty name', () => assertNonEmptyString(result[0].name));
        it('entry has boolean isFile', () => assertBoolean(result[0].isFile));
        it('entry has boolean isDirectory', () => assertBoolean(result[0].isDirectory));
        it('entry has boolean isSymlink', () => assertBoolean(result[0].isSymlink));
    });

    // ──────────────────────────────────────────────────────────────────────────
    // getFileStats()
    // ──────────────────────────────────────────────────────────────────────────

    describe('Filesystem port - getFileStats() with non-existent path must return null', ({ before, it }) => {
        let result;

        before(async () => {
            const filesystem = createFilesystem();
            result = await filesystem.getFileStats(NONEXISTENT);
        });

        it('resolves with null', () => assertEqual(null, result));
    });

    describe('Filesystem port - getFileStats() with an existing file must return a FileStats object', ({ before, after, it }) => {
        let tmpDir;
        let result;

        before(async () => {
            tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-fs-test-'));
            await fsp.writeFile(path.join(tmpDir, 'sample.txt'), 'hello');
            const filesystem = createFilesystem();
            result = await filesystem.getFileStats(path.join(tmpDir, 'sample.txt'));
        });

        after(async () => {
            await fsp.rm(tmpDir, { recursive: true, force: true });
        });

        it('resolves with an object', () => assertDefined(result));
        it('has boolean isFile', () => assertBoolean(result.isFile));
        it('has boolean isDirectory', () => assertBoolean(result.isDirectory));
        it('has boolean isSymlink', () => assertBoolean(result.isSymlink));
        it('has numeric size', () => assertNumberNotNaN(result.size));
        it('has valid atime', () => assertValidDate(result.atime));
        it('has valid mtime', () => assertValidDate(result.mtime));
        it('has valid ctime', () => assertValidDate(result.ctime));
        it('has valid birthtime', () => assertValidDate(result.birthtime));
    });

    // ──────────────────────────────────────────────────────────────────────────
    // readUtf8File()
    // ──────────────────────────────────────────────────────────────────────────

    describe('Filesystem port - readUtf8File() with non-existent path must return null', ({ before, it }) => {
        let result;

        before(async () => {
            const filesystem = createFilesystem();
            result = await filesystem.readUtf8File(NONEXISTENT);
        });

        it('resolves with null', () => assertEqual(null, result));
    });

    describe('Filesystem port - readUtf8File() with an existing file must return the contents as a string', ({ before, after, it }) => {
        let tmpDir;
        let result;

        before(async () => {
            tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-fs-test-'));
            await fsp.writeFile(path.join(tmpDir, 'sample.txt'), 'hello world', { encoding: 'utf8' });
            const filesystem = createFilesystem();
            result = await filesystem.readUtf8File(path.join(tmpDir, 'sample.txt'));
        });

        after(async () => {
            await fsp.rm(tmpDir, { recursive: true, force: true });
        });

        it('resolves with a string', () => assertEqual('string', typeof result));
        it('resolves with the file contents', () => assertEqual('hello world', result));
    });

    // ──────────────────────────────────────────────────────────────────────────
    // readJSONFile()
    // ──────────────────────────────────────────────────────────────────────────

    describe('Filesystem port - readJSONFile() with non-existent path must return null', ({ before, it }) => {
        let result;

        before(async () => {
            const filesystem = createFilesystem();
            result = await filesystem.readJSONFile(NONEXISTENT);
        });

        it('resolves with null', () => assertEqual(null, result));
    });

    describe('Filesystem port - readJSONFile() with an empty file must return undefined', ({ before, after, it }) => {
        let tmpDir;
        let result;

        before(async () => {
            tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-fs-test-'));
            await fsp.writeFile(path.join(tmpDir, 'empty.json'), '');
            const filesystem = createFilesystem();
            result = await filesystem.readJSONFile(path.join(tmpDir, 'empty.json'));
        });

        after(async () => {
            await fsp.rm(tmpDir, { recursive: true, force: true });
        });

        it('resolves with undefined', () => assertEqual(undefined, result));
    });

    describe('Filesystem port - readJSONFile() with invalid JSON must throw ValidationError', ({ before, after, it }) => {
        let tmpDir;
        let error;

        before(async () => {
            tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-fs-test-'));
            await fsp.writeFile(path.join(tmpDir, 'invalid.json'), '{"key": [}');
            const filesystem = createFilesystem();
            try {
                await filesystem.readJSONFile(path.join(tmpDir, 'invalid.json'));
            } catch (err) {
                error = err;
            }
        });

        after(async () => {
            await fsp.rm(tmpDir, { recursive: true, force: true });
        });

        it('throws an error', () => assertDefined(error));
        it('error.name is ValidationError', () => assertEqual('ValidationError', error.name));
        it('error.code is VALIDATION_ERROR', () => assertEqual('VALIDATION_ERROR', error.code));
    });

    describe('Filesystem port - readJSONFile() with a valid JSON file must return the parsed object', ({ before, after, it }) => {
        let tmpDir;
        let result;

        before(async () => {
            tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-fs-test-'));
            await fsp.writeFile(path.join(tmpDir, 'valid.json'), '{ "foo": "bar" }');
            const filesystem = createFilesystem();
            result = await filesystem.readJSONFile(path.join(tmpDir, 'valid.json'));
        });

        after(async () => {
            await fsp.rm(tmpDir, { recursive: true, force: true });
        });

        it('resolves with the parsed object', () => assertEqual('bar', result.foo));
    });

    // ──────────────────────────────────────────────────────────────────────────
    // ensureDir()
    // ──────────────────────────────────────────────────────────────────────────

    describe('Filesystem port - ensureDir() must be idempotent', ({ before, after, it }) => {
        let tmpBase;
        let error;

        before(async () => {
            tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-fs-test-'));
            const dir = path.join(tmpBase, 'nested', 'new-dir');
            const filesystem = createFilesystem();
            await filesystem.ensureDir(dir);
            try {
                await filesystem.ensureDir(dir);
            } catch (err) {
                error = err;
            }
        });

        after(async () => {
            await fsp.rm(tmpBase, { recursive: true, force: true });
        });

        it('second call does not throw', () => assertEqual(undefined, error));
    });

    // ──────────────────────────────────────────────────────────────────────────
    // ensureFile()
    // ──────────────────────────────────────────────────────────────────────────

    describe('Filesystem port - ensureFile() must be idempotent', ({ before, after, it }) => {
        let tmpDir;
        let error;
        let contentAfter;

        before(async () => {
            tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-fs-test-'));
            const file = path.join(tmpDir, 'my-file.txt');
            const filesystem = createFilesystem();
            await filesystem.ensureFile(file);
            await fsp.writeFile(file, 'existing content', { encoding: 'utf8' });
            try {
                await filesystem.ensureFile(file);
            } catch (err) {
                error = err;
            }
            contentAfter = await fsp.readFile(file, { encoding: 'utf8' });
        });

        after(async () => {
            await fsp.rm(tmpDir, { recursive: true, force: true });
        });

        it('second call does not throw', () => assertEqual(undefined, error));
        it('second call does not modify file contents', () => assertEqual('existing content', contentAfter));
    });

    // ──────────────────────────────────────────────────────────────────────────
    // createReadStream()
    // ──────────────────────────────────────────────────────────────────────────

    describe('Filesystem port - createReadStream() with non-existent path must return null', ({ it }) => {
        it('returns null', () => {
            const filesystem = createFilesystem();
            const result = filesystem.createReadStream(NONEXISTENT);
            assertEqual(null, result);
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // toPathString()
    // ──────────────────────────────────────────────────────────────────────────

    describe('Filesystem port - toPathString() with a string must return the input unchanged', ({ it }) => {
        it('returns the input string', () => {
            const filesystem = createFilesystem();
            assertEqual('/some/path/to/file.txt', filesystem.toPathString('/some/path/to/file.txt'));
        });
    });

    describe('Filesystem port - toPathString() with a file:// URL must return a path string', ({ it }) => {
        it('returns a plain path string without the file:// protocol', () => {
            const filesystem = createFilesystem();
            const url = new URL('file:///some/path/to/file.txt');
            assertEqual('/some/path/to/file.txt', filesystem.toPathString(url));
        });
    });
}
