import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import PageStore from '../../lib/hyperview/page-store.js';


const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));


describe('PageStore#doesPageExist() when stats isDirectory is true', ({ before, it }) => {
    const directory = THIS_DIR;

    const stats = {
        isDirectory: sinon.fake.returns(true),
    };

    const fileSystem = {
        getFileStats: sinon.fake.resolves(stats),
    };

    let result;

    before(async () => {
        const store = new PageStore({ directory, fileSystem });
        result = await store.doesPageExist('/blog/a-blog-post');
    });

    it('passes the full directory path to getFileStats()', () => {
        const dirpath = path.join(directory, 'blog', 'a-blog-post');
        assertEqual(1, fileSystem.getFileStats.callCount);
        assertEqual(dirpath, fileSystem.getFileStats.firstCall.firstArg);
    });

    it('calls isDirectory() on stats', () => {
        assertEqual(1, stats.isDirectory.callCount);
    });

    it('returns true', () => {
        assertEqual(true, result);
    });
});
