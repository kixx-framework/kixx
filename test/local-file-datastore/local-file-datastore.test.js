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
