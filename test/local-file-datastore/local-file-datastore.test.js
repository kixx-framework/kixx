import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertNotEqual, isPlainObject } from 'kixx-assert';

import LocalFileDatastore from '../../lib/local-file-datastore/local-file-datastore.js';


// Get the directory containing this test file - used as the base directory
// for PageStore in all tests. This pattern works for both CommonJS and ES modules.
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const directory = path.join(THIS_DIR, 'fake-datatstore');


describe('LocalFileDatastore#getItem() when document exists', ({ before, after, it }) => {
    const document = {
        type: 'User',
        id: 'foo123',
    };

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            {
                name: 'User__foo123.json',
                isFile() {
                    return true;
                },
            },
        ]),
        readDocumentFile: sinon.stub().resolves(document),
    };

    const store = new LocalFileDatastore({
        directory,
        fileSystem,
    });

    before(async () => {
        await store.initialize();
    });

    after(() => {
        sinon.restore();
    });

    it('returns a clone of the stored document', async () => {
        const result1 = await store.getItem('User', 'foo123');
        const result2 = await store.getItem('User', 'foo123');

        assert(isPlainObject(result1));
        assert(isPlainObject(result2));

        assertNotEqual(result1, result2);
        assertNotEqual(document, result1);
        assertNotEqual(document, result2);

        assertEqual('User', result1.type);
        assertEqual('foo123', result1.id);

        assertEqual('User', result2.type);
        assertEqual('foo123', result2.id);
    });
});

describe('LocalFileDatastore#getItem() when document *does not* exist', ({ before, after, it }) => {
    const document = {
        type: 'User',
        id: 'foo123',
    };

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            {
                name: 'User__foo123.json',
                isFile() {
                    return true;
                },
            },
        ]),
        readDocumentFile: sinon.stub().resolves(document),
    };

    const store = new LocalFileDatastore({
        directory,
        fileSystem,
    });

    before(async () => {
        await store.initialize();
    });

    after(() => {
        sinon.restore();
    });

    it('returns null', async () => {
        const result = await store.getItem('User', 'foo456');

        assertEqual(null, result);
    });
});

describe('LocalFileDatastore#setItem() when the document *does not* exist', ({ before, after, it }) => {
    const document = {
        type: 'User',
        id: 'foo123',
        name: 'Test User',
    };

    const fileSystem = {
        readDirectory: sinon.stub().resolves([]),
        writeDocumentFile: sinon.stub().resolves(),
        readDocumentFile: sinon.stub().resolves(null),
    };

    const lockingQueue = {
        getLock: sinon.stub().resolves(true),
        releaseLock: sinon.stub(),
    };

    const store = new LocalFileDatastore({
        directory,
        fileSystem,
        lockingQueue,
    });

    let result;

    before(async () => {
        await store.initialize();
        result = await store.setItem(document);
    });

    after(() => {
        sinon.restore();
    });

    it('calls lockingQueue.getLock() before fileSystem.writeDocumentFile()', () => {
        assertEqual(1, lockingQueue.getLock.callCount);
        assertEqual('User__foo123', lockingQueue.getLock.getCall(0).firstArg);

        // Verify getLock was called before writeDocumentFile
        assert(lockingQueue.getLock.calledBefore(fileSystem.writeDocumentFile));
    });

    it('calls fileSystem.writeDocumentFile with the absolute filepath and cloned document object', () => {
        assertEqual(1, fileSystem.writeDocumentFile.callCount);

        const expectedPath = path.join(directory, 'User__foo123.json');
        const call = fileSystem.writeDocumentFile.getCall(0);
        assertEqual(expectedPath, call.firstArg);

        // Verify the document was cloned (not the same reference)
        const savedDoc = call.args[1];
        assertNotEqual(document, savedDoc);

        // Verify document properties
        assertEqual('User', savedDoc.type);
        assertEqual('foo123', savedDoc.id);
        assertEqual(0, savedDoc._rev);
    });

    it('calls lockingQueue.releaseLock() after fileSystem.writeDocumentFile()', () => {
        assertEqual(1, lockingQueue.releaseLock.callCount);
        assertEqual('User__foo123', lockingQueue.releaseLock.getCall(0).firstArg);

        // Verify releaseLock was called after writeDocumentFile
        assert(lockingQueue.releaseLock.calledAfter(fileSystem.writeDocumentFile));
    });

    it('can use LocalFileDatastore#getItem() to get the saved document', async () => {
        const retrieved = await store.getItem('User', 'foo123');

        assert(isPlainObject(retrieved));

        // Verify it's a clone (different reference)
        assertNotEqual(result, retrieved);

        // Verify document properties
        assertEqual('User', retrieved.type);
        assertEqual('foo123', retrieved.id);
        assertEqual(0, retrieved._rev);
    });
});

describe('LocalFileDatastore#setItem() when the document exists but the updated document does not have a _rev property', ({ before, after, it }) => {
    const existingDocument = {
        type: 'User',
        id: 'foo123',
        name: 'Original User',
        _rev: 0,
    };

    const updatedDocument = {
        type: 'User',
        id: 'foo123',
        name: 'Updated User',
        // No _rev property - this is the key aspect of this test
    };

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            {
                name: 'User__foo123.json',
                isFile() {
                    return true;
                },
            },
        ]),
        writeDocumentFile: sinon.stub().resolves(),
        readDocumentFile: sinon.stub().resolves(existingDocument),
    };

    const lockingQueue = {
        getLock: sinon.stub().resolves(true),
        releaseLock: sinon.stub(),
    };

    const store = new LocalFileDatastore({
        directory,
        fileSystem,
        lockingQueue,
    });

    let result;

    before(async () => {
        await store.initialize();
        result = await store.setItem(updatedDocument);
    });

    after(() => {
        sinon.restore();
    });

    it('calls lockingQueue.getLock() before fileSystem.writeDocumentFile()', () => {
        assertEqual(1, lockingQueue.getLock.callCount);
        assertEqual('User__foo123', lockingQueue.getLock.getCall(0).firstArg);
    });

    it('calls fileSystem.writeDocumentFile with the absolute filepath and cloned document object', () => {
        assertEqual(1, fileSystem.writeDocumentFile.callCount);

        const expectedPath = path.join(directory, 'User__foo123.json');
        const call = fileSystem.writeDocumentFile.getCall(0);
        assertEqual(expectedPath, call.firstArg);

        // Verify the document was cloned (not the same reference)
        const savedDoc = call.args[1];
        assertNotEqual(updatedDocument, savedDoc);

        // Verify document properties
        assertEqual('User', savedDoc.type);
        assertEqual('foo123', savedDoc.id);
        assertEqual('Updated User', savedDoc.name);
        // _rev should be incremented from 0 to 1
        assertEqual(1, savedDoc._rev);
    });

    it('calls lockingQueue.releaseLock() after fileSystem.writeDocumentFile()', () => {
        assertEqual(1, lockingQueue.releaseLock.callCount);
        assertEqual('User__foo123', lockingQueue.releaseLock.getCall(0).firstArg);
    });

    it('returns the document with incremented _rev', () => {
        assert(isPlainObject(result));
        assertEqual('User', result.type);
        assertEqual('foo123', result.id);
        assertEqual('Updated User', result.name);
        assertEqual(1, result._rev);
    });

    it('can use LocalFileDatastore#getItem() to get the saved document', async () => {
        const retrieved = await store.getItem('User', 'foo123');

        assert(isPlainObject(retrieved));

        // Verify it's a clone (different reference)
        assertNotEqual(result, retrieved);

        // Verify document properties
        assertEqual('User', retrieved.type);
        assertEqual('foo123', retrieved.id);
        assertEqual('Updated User', retrieved.name);
        assertEqual(1, retrieved._rev);
    });
});

describe('LocalFileDatastore#setItem() when the document exists and the updated document has a matching _rev property', ({ before, after, it }) => {
    const existingDocument = {
        type: 'User',
        id: 'foo456',
        name: 'Original User',
        _rev: 0,
    };

    const updatedDocument = {
        type: 'User',
        id: 'foo456',
        name: 'Updated User',
        _rev: 0, // Matching _rev - should pass consistency check
    };

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            {
                name: 'User__foo456.json',
                isFile() {
                    return true;
                },
            },
        ]),
        writeDocumentFile: sinon.stub().resolves(),
        readDocumentFile: sinon.stub().resolves(existingDocument),
    };

    const lockingQueue = {
        getLock: sinon.stub().resolves(true),
        releaseLock: sinon.stub(),
    };

    const store = new LocalFileDatastore({
        directory,
        fileSystem,
        lockingQueue,
    });

    let result;

    before(async () => {
        await store.initialize();
        result = await store.setItem(updatedDocument);
    });

    after(() => {
        sinon.restore();
    });

    it('calls lockingQueue.getLock() before fileSystem.writeDocumentFile()', () => {
        assertEqual(1, lockingQueue.getLock.callCount);
        assertEqual('User__foo456', lockingQueue.getLock.getCall(0).firstArg);
    });

    it('calls fileSystem.writeDocumentFile with the absolute filepath and cloned document object', () => {
        assertEqual(1, fileSystem.writeDocumentFile.callCount);

        const expectedPath = path.join(directory, 'User__foo456.json');
        const call = fileSystem.writeDocumentFile.getCall(0);
        assertEqual(expectedPath, call.firstArg);

        // Verify the document was cloned (not the same reference)
        const savedDoc = call.args[1];
        assertNotEqual(updatedDocument, savedDoc);

        // Verify document properties
        assertEqual('User', savedDoc.type);
        assertEqual('foo456', savedDoc.id);
        assertEqual('Updated User', savedDoc.name);
        // _rev should be incremented from 0 to 1
        assertEqual(1, savedDoc._rev);
    });

    it('calls lockingQueue.releaseLock() after fileSystem.writeDocumentFile()', () => {
        assertEqual(1, lockingQueue.releaseLock.callCount);
        assertEqual('User__foo456', lockingQueue.releaseLock.getCall(0).firstArg);
    });

    it('passes the consistency check and returns the document with incremented _rev', () => {
        assert(isPlainObject(result));
        assertEqual('User', result.type);
        assertEqual('foo456', result.id);
        assertEqual('Updated User', result.name);
        assertEqual(1, result._rev);
    });

    it('can use LocalFileDatastore#getItem() to get the saved document', async () => {
        const retrieved = await store.getItem('User', 'foo456');

        assert(isPlainObject(retrieved));

        // Verify it's a clone (different reference)
        assertNotEqual(result, retrieved);

        // Verify document properties
        assertEqual('User', retrieved.type);
        assertEqual('foo456', retrieved.id);
        assertEqual('Updated User', retrieved.name);
        assertEqual(1, retrieved._rev);
    });
});

describe('LocalFileDatastore#setItem() when the document exists and the updated document has a mismatched _rev property', ({ before, after, it }) => {
    const existingDocument = {
        type: 'User',
        id: 'foo789',
        name: 'Original User',
        _rev: 1, // Current revision is 1
    };

    const updatedDocument = {
        type: 'User',
        id: 'foo789',
        name: 'Updated User',
        _rev: 0, // Trying to update with stale revision 0 - should fail
    };

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            {
                name: 'User__foo789.json',
                isFile() {
                    return true;
                },
            },
        ]),
        writeDocumentFile: sinon.stub().resolves(),
        readDocumentFile: sinon.stub().resolves(existingDocument),
    };

    const lockingQueue = {
        getLock: sinon.stub().resolves(true),
        releaseLock: sinon.stub(),
    };

    const store = new LocalFileDatastore({
        directory,
        fileSystem,
        lockingQueue,
    });

    let error;

    before(async () => {
        await store.initialize();
        try {
            await store.setItem(updatedDocument);
        } catch (err) {
            error = err;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('throws an AssertionError with ConflictError code', () => {
        assert(error);
        assertEqual('AssertionError', error.name);
        assertEqual('CONFLICT_ERROR', error.code);
    });

    it('includes a descriptive error message', () => {
        assert(error);
        assertNotEqual(-1, error.message.indexOf('User__foo789'));
        assertNotEqual(-1, error.message.indexOf('modified since it was last read'));
    });

    it('calls lockingQueue.getLock() but not writeDocumentFile', () => {
        assertEqual(1, lockingQueue.getLock.callCount);
        assertEqual('User__foo789', lockingQueue.getLock.getCall(0).firstArg);

        // writeDocumentFile should NOT be called when consistency check fails
        assertEqual(0, fileSystem.writeDocumentFile.callCount);
    });

    it('releases the lock even when the error is thrown', () => {
        assertEqual(1, lockingQueue.releaseLock.callCount);
        assertEqual('User__foo789', lockingQueue.releaseLock.getCall(0).firstArg);
    });

    it('does not update the document in memory', async () => {
        const retrieved = await store.getItem('User', 'foo789');

        assert(isPlainObject(retrieved));

        // Document should still have original values
        assertEqual('User', retrieved.type);
        assertEqual('foo789', retrieved.id);
        assertEqual('Original User', retrieved.name);
        assertEqual(1, retrieved._rev);
    });
});

describe('LocalFileDatastore#setItem() when writeDocumentFile throws an error', ({ before, after, it }) => {
    const document = {
        type: 'User',
        id: 'foo999',
        name: 'Test User',
    };

    const fileSystem = {
        readDirectory: sinon.stub().resolves([]),
        writeDocumentFile: sinon.stub().rejects(new Error('Disk write failed')),
        readDocumentFile: sinon.stub().resolves(null),
    };

    const lockingQueue = {
        getLock: sinon.stub().resolves(true),
        releaseLock: sinon.stub(),
    };

    const store = new LocalFileDatastore({
        directory,
        fileSystem,
        lockingQueue,
    });

    let error;

    before(async () => {
        await store.initialize();
        try {
            await store.setItem(document);
        } catch (err) {
            error = err;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('throws the disk write error', () => {
        assert(error);
        assertNotEqual(-1, error.message.indexOf('Unexpected error while writing LocalFileDatastore file'));
    });

    it('releases the lock even when write fails', () => {
        assertEqual(1, lockingQueue.releaseLock.callCount);
        assertEqual('User__foo999', lockingQueue.releaseLock.getCall(0).firstArg);
    });

    it('does not update the document in memory', async () => {
        const retrieved = await store.getItem('User', 'foo999');
        assertEqual(null, retrieved);
    });
});

describe('LocalFileDatastore#setItem() when the document id contains special characters', ({ before, after, it }) => {
    const testCases = [
        {
            description: 'forward slashes',
            id: 'user/admin/123',
            expectedEncoding: 'User__user%2Fadmin%2F123.json',
        },
        {
            description: 'backslashes',
            id: 'path\\to\\resource',
            expectedEncoding: 'User__path%5Cto%5Cresource.json',
        },
        {
            description: 'colons',
            id: 'namespace:resource:id',
            expectedEncoding: 'User__namespace%3Aresource%3Aid.json',
        },
        {
            description: 'spaces',
            id: 'first last name',
            expectedEncoding: 'User__first%20last%20name.json',
        },
        {
            description: 'question marks and asterisks',
            id: 'query?foo=bar*',
            expectedEncoding: 'User__query%3Ffoo%3Dbar*.json',
        },
        {
            description: 'angle brackets and pipes',
            id: 'test<tag>|pipe',
            expectedEncoding: 'User__test%3Ctag%3E%7Cpipe.json',
        },
        {
            description: 'quotes',
            id: 'test"double\'single',
            expectedEncoding: 'User__test%22double\'single.json',
        },
        {
            description: 'unicode emoji',
            id: 'user-🚀-emoji',
            expectedEncoding: 'User__user-%F0%9F%9A%80-emoji.json',
        },
        {
            description: 'accented characters',
            id: 'café-señor-naïve',
            expectedEncoding: 'User__caf%C3%A9-se%C3%B1or-na%C3%AFve.json',
        },
        {
            description: 'dots and hyphens',
            id: 'test.example-123',
            expectedEncoding: 'User__test.example-123.json',
        },
    ];

    const fileSystem = {
        readDirectory: sinon.stub().resolves([]),
        writeDocumentFile: sinon.stub().resolves(),
        readDocumentFile: sinon.stub().resolves(null),
    };

    const store = new LocalFileDatastore({
        directory,
        fileSystem,
    });

    const results = [];

    before(async () => {
        await store.initialize();

        for (const testCase of testCases) {
            const document = {
                type: 'User',
                id: testCase.id,
                name: `Test ${ testCase.description }`,
            };

            // eslint-disable-next-line no-await-in-loop
            const result = await store.setItem(document);
            results.push({ testCase, result });
        }
    });

    after(() => {
        sinon.restore();
    });

    it('saves all documents with special characters', () => {
        assertEqual(testCases.length, results.length);
    });

    it('encodes filenames with forward slashes correctly', () => {
        const callArg = fileSystem.writeDocumentFile.getCall(0).firstArg;
        assertNotEqual(-1, callArg.indexOf('User__user%2Fadmin%2F123.json'));
    });

    it('encodes filenames with backslashes correctly', () => {
        const callArg = fileSystem.writeDocumentFile.getCall(1).firstArg;
        assertNotEqual(-1, callArg.indexOf('User__path%5Cto%5Cresource.json'));
    });

    it('encodes filenames with colons correctly', () => {
        const callArg = fileSystem.writeDocumentFile.getCall(2).firstArg;
        assertNotEqual(-1, callArg.indexOf('User__namespace%3Aresource%3Aid.json'));
    });

    it('encodes filenames with spaces correctly', () => {
        const callArg = fileSystem.writeDocumentFile.getCall(3).firstArg;
        assertNotEqual(-1, callArg.indexOf('User__first%20last%20name.json'));
    });

    it('encodes filenames with question marks and asterisks correctly', () => {
        const callArg = fileSystem.writeDocumentFile.getCall(4).firstArg;
        assertNotEqual(-1, callArg.indexOf('User__query%3Ffoo%3Dbar*.json'));
    });

    it('encodes filenames with angle brackets and pipes correctly', () => {
        const callArg = fileSystem.writeDocumentFile.getCall(5).firstArg;
        assertNotEqual(-1, callArg.indexOf('User__test%3Ctag%3E%7Cpipe.json'));
    });

    it('encodes filenames with quotes correctly', () => {
        const callArg = fileSystem.writeDocumentFile.getCall(6).firstArg;
        assertNotEqual(-1, callArg.indexOf('User__test%22double\'single.json'));
    });

    it('encodes filenames with unicode emoji correctly', () => {
        const callArg = fileSystem.writeDocumentFile.getCall(7).firstArg;
        assertNotEqual(-1, callArg.indexOf('User__user-%F0%9F%9A%80-emoji.json'));
    });

    it('encodes filenames with accented characters correctly', () => {
        const callArg = fileSystem.writeDocumentFile.getCall(8).firstArg;
        assertNotEqual(-1, callArg.indexOf('User__caf%C3%A9-se%C3%B1or-na%C3%AFve.json'));
    });

    it('allows dots and hyphens without encoding', () => {
        const callArg = fileSystem.writeDocumentFile.getCall(9).firstArg;
        assertNotEqual(-1, callArg.indexOf('User__test.example-123.json'));
    });

    it('returns documents with original unencoded IDs', () => {
        for (let i = 0; i < results.length; i += 1) {
            const { testCase, result } = results[i];
            assertEqual(testCase.id, result.id);
            assertEqual('User', result.type);
        }
    });

    it('stores documents in memory with original IDs', async () => {
        for (const testCase of testCases) {
            // eslint-disable-next-line no-await-in-loop
            const retrieved = await store.getItem('User', testCase.id);
            assert(isPlainObject(retrieved));
            assertEqual(testCase.id, retrieved.id);
            assertEqual('User', retrieved.type);
        }
    });
});

describe('LocalFileDatastore#deleteItem() when removeDocumentFile throws an error', ({ before, after, it }) => {
    const existingDocument = {
        type: 'User',
        id: 'foo888',
        name: 'Test User',
        _rev: 0,
    };

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            {
                name: 'User__foo888.json',
                isFile() {
                    return true;
                },
            },
        ]),
        readDocumentFile: sinon.stub().resolves(existingDocument),
        removeDocumentFile: sinon.stub().rejects(new Error('Disk delete failed')),
    };

    const lockingQueue = {
        getLock: sinon.stub().resolves(true),
        releaseLock: sinon.stub(),
    };

    const store = new LocalFileDatastore({
        directory,
        fileSystem,
        lockingQueue,
    });

    let error;

    before(async () => {
        await store.initialize();
        try {
            await store.deleteItem('User', 'foo888');
        } catch (err) {
            error = err;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('throws the disk delete error', () => {
        assert(error);
        assertNotEqual(-1, error.message.indexOf('Unexpected error while removing LocalFileDatastore file'));
    });

    it('releases the lock even when delete fails', () => {
        assertEqual(1, lockingQueue.releaseLock.callCount);
        assertEqual('User__foo888', lockingQueue.releaseLock.getCall(0).firstArg);
    });

    it('does not remove the document from memory', async () => {
        const retrieved = await store.getItem('User', 'foo888');

        assert(isPlainObject(retrieved));

        // Document should still exist in memory
        assertEqual('User', retrieved.type);
        assertEqual('foo888', retrieved.id);
        assertEqual('Test User', retrieved.name);
        assertEqual(0, retrieved._rev);
    });
});

describe('LocalFileDatastore#deleteItem() when the document exists', ({ before, after, it }) => {
    const existingDocument = {
        type: 'User',
        id: 'foo777',
        name: 'Delete Me',
        _rev: 2,
    };

    const fileSystem = {
        readDirectory: sinon.stub().resolves([
            {
                name: 'User__foo777.json',
                isFile() {
                    return true;
                },
            },
        ]),
        readDocumentFile: sinon.stub().resolves(existingDocument),
        removeDocumentFile: sinon.stub().resolves(),
    };

    const lockingQueue = {
        getLock: sinon.stub().resolves(true),
        releaseLock: sinon.stub(),
    };

    const store = new LocalFileDatastore({
        directory,
        fileSystem,
        lockingQueue,
    });

    let result;

    before(async () => {
        await store.initialize();
        result = await store.deleteItem('User', 'foo777');
    });

    after(() => {
        sinon.restore();
    });

    it('returns an object with type and id', () => {
        assert(isPlainObject(result));
        assertEqual('User', result.type);
        assertEqual('foo777', result.id);
    });

    it('calls removeDocumentFile with correct filepath', () => {
        assertEqual(1, fileSystem.removeDocumentFile.callCount);
        assertNotEqual(-1, fileSystem.removeDocumentFile.getCall(0).firstArg.indexOf('User__foo777.json'));
    });

    it('acquires and releases the lock', () => {
        assertEqual(1, lockingQueue.getLock.callCount);
        assertEqual('User__foo777', lockingQueue.getLock.getCall(0).firstArg);

        assertEqual(1, lockingQueue.releaseLock.callCount);
        assertEqual('User__foo777', lockingQueue.releaseLock.getCall(0).firstArg);
    });

    it('calls releaseLock after removeDocumentFile', () => {
        assert(fileSystem.removeDocumentFile.calledBefore(lockingQueue.releaseLock));
    });

    it('removes the document from memory', async () => {
        const retrieved = await store.getItem('User', 'foo777');
        assertEqual(null, retrieved);
    });
});

describe('LocalFileDatastore#deleteItem() when the document does not exist', ({ before, after, it }) => {
    const fileSystem = {
        readDirectory: sinon.stub().resolves([]),
        readDocumentFile: sinon.stub().resolves(null),
        removeDocumentFile: sinon.stub().resolves(),
    };

    const lockingQueue = {
        getLock: sinon.stub().resolves(true),
        releaseLock: sinon.stub(),
    };

    const store = new LocalFileDatastore({
        directory,
        fileSystem,
        lockingQueue,
    });

    let result;

    before(async () => {
        await store.initialize();
        result = await store.deleteItem('User', 'nonexistent');
    });

    after(() => {
        sinon.restore();
    });

    it('returns an object with type and id', () => {
        assert(isPlainObject(result));
        assertEqual('User', result.type);
        assertEqual('nonexistent', result.id);
    });

    it('calls removeDocumentFile even though document does not exist', () => {
        assertEqual(1, fileSystem.removeDocumentFile.callCount);
        assertNotEqual(-1, fileSystem.removeDocumentFile.getCall(0).firstArg.indexOf('User__nonexistent.json'));
    });

    it('acquires and releases the lock', () => {
        assertEqual(1, lockingQueue.getLock.callCount);
        assertEqual('User__nonexistent', lockingQueue.getLock.getCall(0).firstArg);

        assertEqual(1, lockingQueue.releaseLock.callCount);
        assertEqual('User__nonexistent', lockingQueue.releaseLock.getCall(0).firstArg);
    });

    it('does not throw an error (idempotent operation)', () => {
        // The operation succeeds even when document doesn't exist
        // because removeDocumentFile uses force: true
        assert(isPlainObject(result));
    });
});

describe('LocalFileDatastore#scanItems()', ({ before, after, it }) => {
    // Define the documents array to shuffle the key ordering a bit to
    // test the sort order capability of scanItems().
    const documents = [
        { type: 'Record', id: 'ac-xxx' },
        { type: 'Record', id: 'ca-xxx' },
        { type: 'Record', id: 'aa-xxx' },
        { type: 'Record', id: 'ba-xxx' },
        { type: 'Record', id: 'ab-xxx' },
        { type: 'Record', id: 'bc-xxx' },
        { type: 'Record', id: 'bb-xxx' },
    ];

    const fileSystem = {
        readDirectory: sinon.stub().resolves(documents.map(({ type, id }) => {
            return {
                name: `${ type }__${ id }.json`,
                isFile() {
                    return true;
                },
            };
        })),

        readDocumentFile: sinon.stub().callsFake((filepath) => {
            // Convert the "Record__ac-foo.json" file name to type and id.
            const key = path.basename(filepath, '.json');

            const [ type, id ] = key.split('__');

            // Find the document by type and id.
            return documents.find((doc) => {
                return doc.type === type && doc.id === id;
            });
        }),
    };

    const store = new LocalFileDatastore({
        directory,
        fileSystem,
    });

    let page1;
    let page2;
    let page3;

    before(async () => {
        await store.initialize();

        page1 = await store.scanItems('Record', { startKey: 'a', endKey: 'z', limit: 3 });
        page2 = await store.scanItems('Record', { startKey: 'a', endKey: 'z', limit: 3, inclusiveStartIndex: 3 });
        page3 = await store.scanItems('Record', { startKey: 'a', endKey: 'z', limit: 3, inclusiveStartIndex: 6 });
    });

    after(() => {
        sinon.restore();
    });

    it('returns the expected page sizes', () => {
        assertEqual(3, page1.documents.length);
        assertEqual(3, page2.documents.length);
        assertEqual(1, page3.documents.length);
    });

    it('returns expected documents in ascending order', () => {
        assertEqual('aa-xxx', page1.documents[0].id);
        assertEqual('ac-xxx', page1.documents[2].id);
        assertEqual('ba-xxx', page2.documents[0].id);
        assertEqual('bc-xxx', page2.documents[2].id);
        assertEqual('ca-xxx', page3.documents[0].id);
    });

    it('returns expected exclusiveEndIndex values', () => {
        assertEqual(3, page1.exclusiveEndIndex);
        assertEqual(6, page2.exclusiveEndIndex);
        assertEqual(null, page3.exclusiveEndIndex);
    });
});

describe('LocalFileDatastore#scanItems() in descending order', ({ before, after, it }) => {
    // Define the documents array with same data as ascending test
    const documents = [
        { type: 'Record', id: 'cc-xxx' },
        { type: 'Record', id: 'aa-xxx' },
        { type: 'Record', id: 'ca-xxx' },
        { type: 'Record', id: 'ba-xxx' },
        { type: 'Record', id: 'cb-xxx' },
        { type: 'Record', id: 'bc-xxx' },
        { type: 'Record', id: 'bb-xxx' },
    ];

    const fileSystem = {
        readDirectory: sinon.stub().resolves(documents.map(({ type, id }) => {
            return {
                name: `${ type }__${ id }.json`,
                isFile() {
                    return true;
                },
            };
        })),

        readDocumentFile: sinon.stub().callsFake((filepath) => {
            // Convert the "Record__ac-foo.json" file name to type and id.
            const key = path.basename(filepath, '.json');

            const [ type, id ] = key.split('__');

            // Find the document by type and id.
            return documents.find((doc) => {
                return doc.type === type && doc.id === id;
            });
        }),
    };

    const store = new LocalFileDatastore({
        directory,
        fileSystem,
    });

    let page1;
    let page2;
    let page3;

    before(async () => {
        await store.initialize();

        // In descending mode, startKey is high value, endKey is low value
        page1 = await store.scanItems('Record', { startKey: 'z', endKey: 'a', descending: true, limit: 3 });
        page2 = await store.scanItems('Record', { startKey: 'z', endKey: 'a', descending: true, limit: 3, inclusiveStartIndex: 3 });
        page3 = await store.scanItems('Record', { startKey: 'z', endKey: 'a', descending: true, limit: 3, inclusiveStartIndex: 6 });
    });

    after(() => {
        sinon.restore();
    });

    it('returns the expected page sizes', () => {
        assertEqual(3, page1.documents.length);
        assertEqual(3, page2.documents.length);
        assertEqual(1, page3.documents.length);
    });

    it('returns expected documents in descending order', () => {
        // Should be reverse of ascending: ca, bc, bb, ba, ac, ab, aa
        assertEqual('cc-xxx', page1.documents[0].id);
        assertEqual('ca-xxx', page1.documents[2].id);

        assertEqual('bc-xxx', page2.documents[0].id);
        assertEqual('ba-xxx', page2.documents[2].id);

        assertEqual('aa-xxx', page3.documents[0].id);
    });

    it('returns expected exclusiveEndIndex values', () => {
        assertEqual(3, page1.exclusiveEndIndex);
        assertEqual(6, page2.exclusiveEndIndex);
        assertEqual(null, page3.exclusiveEndIndex);
    });
});

describe('LocalFileDatastore#scanItems() descending with range', ({ before, after, it }) => {
    // Define same 7 documents: aa, ab, ac, ba, bb, bc, ca
    const documents = [
        { type: 'Record', id: 'ac-xxx' },
        { type: 'Record', id: 'ca-xxx' },
        { type: 'Record', id: 'aa-xxx' },
        { type: 'Record', id: 'ba-xxx' },
        { type: 'Record', id: 'ab-xxx' },
        { type: 'Record', id: 'bc-xxx' },
        { type: 'Record', id: 'bb-xxx' },
    ];

    const fileSystem = {
        readDirectory: sinon.stub().resolves(documents.map(({ type, id }) => {
            return { name: `${ type }__${ id }.json`, isFile() {
                return true;
            } };
        })),

        readDocumentFile: sinon.stub().callsFake((filepath) => {
            const key = path.basename(filepath, '.json');
            const [ type, id ] = key.split('__');
            return documents.find((doc) => doc.type === type && doc.id === id);
        }),
    };

    const store = new LocalFileDatastore({ directory, fileSystem });

    let result;

    before(async () => {
        await store.initialize();
        // startKey: 'c' (high), endKey: 'b' (low) in descending mode
        // Range is inclusive: items >= 'b' AND <= 'c'
        // Expected: bc, bb, ba (ca is excluded because 'ca' > 'c')
        result = await store.scanItems('Record', { startKey: 'c', endKey: 'b', descending: true, limit: 10 });
    });

    after(() => {
        sinon.restore();
    });

    it('returns items in descending range from startKey to endKey', () => {
        // Range: items >= 'b' AND <= 'c'
        // bc-: 'bc' is between 'b' and 'c' ✓
        // bb-: 'bb' is between 'b' and 'c' ✓
        // ba-: 'ba' is between 'b' and 'c' ✓
        assertEqual(3, result.documents.length);
        assertEqual('bc-xxx', result.documents[0].id);
        assertEqual('bb-xxx', result.documents[1].id);
        assertEqual('ba-xxx', result.documents[2].id);
    });

    it('excludes items outside range', () => {
        // Items with 'a' prefix (aa, ab, ac) should be excluded (< 'b')
        assertEqual(false, result.documents.some((doc) => doc.id === 'aa-xxx'));
        assertEqual(false, result.documents.some((doc) => doc.id === 'ab-xxx'));
        assertEqual(false, result.documents.some((doc) => doc.id === 'ac-xxx'));
        // ca- is excluded because 'ca' > 'c' (startKey)
        assertEqual(false, result.documents.some((doc) => doc.id === 'ca-xxx'));
    });
});

describe('LocalFileDatastore#scanItems() with no startKey', ({ before, after, it }) => {
    const documents = [
        { type: 'Record', id: 'ac-xxx' },
        { type: 'Record', id: 'ca-xxx' },
        { type: 'Record', id: 'aa-xxx' },
        { type: 'Record', id: 'ba-xxx' },
        { type: 'Record', id: 'ab-xxx' },
        { type: 'Record', id: 'bc-xxx' },
        { type: 'Record', id: 'bb-xxx' },
    ];

    const fileSystem = {
        readDirectory: sinon.stub().resolves(documents.map(({ type, id }) => {
            return { name: `${ type }__${ id }.json`, isFile() {
                return true;
            } };
        })),

        readDocumentFile: sinon.stub().callsFake((filepath) => {
            const key = path.basename(filepath, '.json');
            const [ type, id ] = key.split('__');
            return documents.find((doc) => doc.type === type && doc.id === id);
        }),
    };

    const store = new LocalFileDatastore({ directory, fileSystem });

    let ascendingResult;
    let descendingResult;

    before(async () => {
        await store.initialize();
        // No startKey in ascending mode - should use ALPHA
        ascendingResult = await store.scanItems('Record', { endKey: 'z', descending: false });
        // No startKey in descending mode - should use OMEGA
        descendingResult = await store.scanItems('Record', { endKey: 'a', descending: true });
    });

    after(() => {
        sinon.restore();
    });

    it('uses ALPHA as startKey for ascending (includes all from beginning)', () => {
        assertEqual(7, ascendingResult.documents.length);
        assertEqual('aa-xxx', ascendingResult.documents[0].id);
    });

    it('uses OMEGA as startKey for descending (includes all from end)', () => {
        assertEqual(7, descendingResult.documents.length);
        assertEqual('ca-xxx', descendingResult.documents[0].id);
    });
});

describe('LocalFileDatastore#scanItems() with no endKey', ({ before, after, it }) => {
    const documents = [
        { type: 'Record', id: 'ac-xxx' },
        { type: 'Record', id: 'ca-xxx' },
        { type: 'Record', id: 'aa-xxx' },
        { type: 'Record', id: 'ba-xxx' },
        { type: 'Record', id: 'ab-xxx' },
        { type: 'Record', id: 'bc-xxx' },
        { type: 'Record', id: 'bb-xxx' },
    ];

    const fileSystem = {
        readDirectory: sinon.stub().resolves(documents.map(({ type, id }) => {
            return { name: `${ type }__${ id }.json`, isFile() {
                return true;
            } };
        })),

        readDocumentFile: sinon.stub().callsFake((filepath) => {
            const key = path.basename(filepath, '.json');
            const [ type, id ] = key.split('__');
            return documents.find((doc) => doc.type === type && doc.id === id);
        }),
    };

    const store = new LocalFileDatastore({ directory, fileSystem });

    let ascendingResult;
    let descendingResult;

    before(async () => {
        await store.initialize();
        // No endKey in ascending mode - should use OMEGA
        ascendingResult = await store.scanItems('Record', { startKey: 'a', descending: false });
        // No endKey in descending mode - should use ALPHA
        descendingResult = await store.scanItems('Record', { startKey: 'z', descending: true });
    });

    after(() => {
        sinon.restore();
    });

    it('uses OMEGA as endKey for ascending (includes all to end)', () => {
        assertEqual(7, ascendingResult.documents.length);
        assertEqual('ca-xxx', ascendingResult.documents[6].id);
    });

    it('uses ALPHA as endKey for descending (includes all to beginning)', () => {
        assertEqual(7, descendingResult.documents.length);
        assertEqual('aa-xxx', descendingResult.documents[6].id);
    });
});

describe('LocalFileDatastore#scanItems() with empty datastore', ({ before, after, it }) => {
    const fileSystem = {
        readDirectory: sinon.stub().resolves([]),
        readDocumentFile: sinon.stub().resolves(null),
    };

    const store = new LocalFileDatastore({ directory, fileSystem });

    let result;

    before(async () => {
        await store.initialize();
        result = await store.scanItems('Record', { startKey: 'a', endKey: 'z' });
    });

    after(() => {
        sinon.restore();
    });

    it('returns empty documents array', () => {
        assertEqual(0, result.documents.length);
    });

    it('returns null exclusiveEndIndex', () => {
        assertEqual(null, result.exclusiveEndIndex);
    });
});

describe('LocalFileDatastore#scanItems() with no matching documents', ({ before, after, it }) => {
    const documents = [
        { type: 'Record', id: 'aa-xxx' },
        { type: 'Record', id: 'ab-xxx' },
        { type: 'Record', id: 'ac-xxx' },
    ];

    const fileSystem = {
        readDirectory: sinon.stub().resolves(documents.map(({ type, id }) => {
            return { name: `${ type }__${ id }.json`, isFile() {
                return true;
            } };
        })),

        readDocumentFile: sinon.stub().callsFake((filepath) => {
            const key = path.basename(filepath, '.json');
            const [ type, id ] = key.split('__');
            return documents.find((doc) => doc.type === type && doc.id === id);
        }),
    };

    const store = new LocalFileDatastore({ directory, fileSystem });

    before(async () => {
        await store.initialize();
    });

    after(() => {
        sinon.restore();
    });

    it('returns empty when startKey > all documents', async () => {
        // startKey: 'z', endKey: 'zz' - no documents match (all start with 'a')
        const result = await store.scanItems('Record', { startKey: 'z', endKey: 'zz' });
        assertEqual(0, result.documents.length);
        assertEqual(null, result.exclusiveEndIndex);
    });

    it('returns empty when endKey < all documents', async () => {
        // startKey: '0', endKey: '1' - no documents match (all start with letters)
        const result = await store.scanItems('Record', { startKey: '0', endKey: '1' });
        assertEqual(0, result.documents.length);
        assertEqual(null, result.exclusiveEndIndex);
    });
});

describe('LocalFileDatastore#scanItems() with inclusiveStartIndex beyond data', ({ before, after, it }) => {
    const documents = [
        { type: 'Record', id: 'aa-xxx' },
        { type: 'Record', id: 'ab-xxx' },
        { type: 'Record', id: 'ac-xxx' },
    ];

    const fileSystem = {
        readDirectory: sinon.stub().resolves(documents.map(({ type, id }) => {
            return { name: `${ type }__${ id }.json`, isFile() {
                return true;
            } };
        })),

        readDocumentFile: sinon.stub().callsFake((filepath) => {
            const key = path.basename(filepath, '.json');
            const [ type, id ] = key.split('__');
            return documents.find((doc) => doc.type === type && doc.id === id);
        }),
    };

    const store = new LocalFileDatastore({ directory, fileSystem });

    before(async () => {
        await store.initialize();
    });

    after(() => {
        sinon.restore();
    });

    it('returns empty when inclusiveStartIndex equals total count', async () => {
        const result = await store.scanItems('Record', {
            startKey: 'a',
            endKey: 'z',
            inclusiveStartIndex: 3,
            limit: 3,
        });

        assertEqual(0, result.documents.length);
        assertEqual(null, result.exclusiveEndIndex);
    });

    it('returns empty when inclusiveStartIndex exceeds total count', async () => {
        const result = await store.scanItems('Record', {
            startKey: 'a',
            endKey: 'z',
            inclusiveStartIndex: 100,
            limit: 3,
        });

        assertEqual(0, result.documents.length);
        assertEqual(null, result.exclusiveEndIndex);
    });
});

describe('LocalFileDatastore#scanItems() with limit larger than data', ({ before, after, it }) => {
    const documents = [
        { type: 'Record', id: 'aa-xxx' },
        { type: 'Record', id: 'ab-xxx' },
        { type: 'Record', id: 'ac-xxx' },
    ];

    const fileSystem = {
        readDirectory: sinon.stub().resolves(documents.map(({ type, id }) => {
            return { name: `${ type }__${ id }.json`, isFile() {
                return true;
            } };
        })),

        readDocumentFile: sinon.stub().callsFake((filepath) => {
            const key = path.basename(filepath, '.json');
            const [ type, id ] = key.split('__');
            return documents.find((doc) => doc.type === type && doc.id === id);
        }),
    };

    const store = new LocalFileDatastore({ directory, fileSystem });

    let result;

    before(async () => {
        await store.initialize();
        // The startKey will default to ALPHA and endKey will default to OMEGA
        result = await store.scanItems('Record', { limit: 100 });
    });

    after(() => {
        sinon.restore();
    });

    it('returns all available documents', () => {
        assertEqual(3, result.documents.length);
    });

    it('returns null exclusiveEndIndex (no more pages)', () => {
        assertEqual(null, result.exclusiveEndIndex);
    });
});
