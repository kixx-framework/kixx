import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual, assert, assertNonEmptyString } from 'kixx-assert';
import * as NodeFilesystem from '../../../lib/node/filesystem/mod.js';
import { testFilesystemConformance } from '../../conformance/filesystem.js';


const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const NODE_FILESYSTEM_FILE = path.resolve(THIS_DIR, '../../../lib/node/filesystem/mod.js');

testFilesystemConformance(() => NodeFilesystem);

describe('NodeFilesystem#createReadStream() with an existing file returns a ReadStream', ({ before, after, it }) => {
    let tmpDir;
    let result;

    before(async () => {
        tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-fs-test-'));
        await fsp.writeFile(path.join(tmpDir, 'sample.txt'), 'hello');
        result = NodeFilesystem.createReadStream(path.join(tmpDir, 'sample.txt'));
    });

    after(async () => {
        result.destroy();
        await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    it('returns a non-null stream', () => assert(result !== null));
    it('stream has a pipe method', () => assertEqual('function', typeof result.pipe));
});

describe('NodeFilesystem#importAbsoluteFilepath() imports an ES module from an absolute path', ({ before, it }) => {
    let result;

    before(async () => {
        result = await NodeFilesystem.importAbsoluteFilepath(NODE_FILESYSTEM_FILE);
    });

    it('resolves with a module namespace object', () => assertEqual('object', typeof result));
    it('the module exports importAbsoluteFilepath', () => assertEqual('function', typeof result.importAbsoluteFilepath));
});

describe('NodeFilesystem#toPathString() with a file:// URL converts to a platform path', ({ it }) => {
    it('strips the file:// protocol and decodes percent-encoding', () => {
        const url = new URL('file:///some/path/with%20space/file.txt');
        const result = NodeFilesystem.toPathString(url);
        assertNonEmptyString(result);
        assert(!result.includes('file://'), 'must not contain file:// protocol');
        assert(result.includes('with space'), 'must decode percent-encoding');
    });
});
