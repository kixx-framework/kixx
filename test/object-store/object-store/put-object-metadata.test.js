import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';
import ObjectStore from '../../../object-store/object-store.js';


describe('ObjectStore:putObjectMetadata() putObjectMetadata throws', ({ before, after, it }) => {
    let sandbox;
    let objectStore;
    let db;
    const objectId = 'an-object-123';
    const referenceId = 'some-image.jpg';
    const document = {};
    let error;

    before(async () => {
        sandbox = sinon.createSandbox();

        db = {
            getObjectHeaders: sinon.fake.resolves(new Headers()),
            putObjectMetadata: sinon.fake.rejects(new Error('putObjectMetadata')),
        };

        const lockingQueue = null;

        objectStore = new ObjectStore({ lockingQueue, db });

        sandbox.replace(objectStore, 'getLock', sinon.fake.resolves());
        sandbox.replace(objectStore, 'releaseLock', sinon.fake.returns());

        try {
            await objectStore.putObjectMetadata(objectId, referenceId, document);
        } catch (e) {
            error = e;
        }
    });

    after(() => {
        if (sandbox) {
            sandbox.restore();
        }
    });

    it('gets a resource lock', () => {
        assertEqual(1, objectStore.getLock.callCount);
    });

    it('releases the resource lock', () => {
        assertEqual(1, objectStore.releaseLock.callCount);
    });

    it('throws an error', () => {
        assertEqual('putObjectMetadata', error.message);
    });
});

describe('ObjectStore:putObjectMetadata() getObjectHeaders throws', ({ before, after, it }) => {
    let sandbox;
    let objectStore;
    let db;
    const objectId = 'an-object-123';
    const referenceId = 'some-image.jpg';
    const document = {};
    let error;

    before(async () => {
        sandbox = sinon.createSandbox();

        db = {
            getObjectHeaders: sinon.fake.rejects(new Error('getObjectHeaders')),
            putObjectMetadata: sinon.fake.resolves(),
        };

        const lockingQueue = null;

        objectStore = new ObjectStore({ lockingQueue, db });

        sandbox.replace(objectStore, 'getLock', sinon.fake.resolves());
        sandbox.replace(objectStore, 'releaseLock', sinon.fake.returns());

        try {
            await objectStore.putObjectMetadata(objectId, referenceId, document);
        } catch (e) {
            error = e;
        }
    });

    after(() => {
        if (sandbox) {
            sandbox.restore();
        }
    });

    it('gets a resource lock', () => {
        assertEqual(1, objectStore.getLock.callCount);
    });

    it('releases the resource lock', () => {
        assertEqual(1, objectStore.releaseLock.callCount);
    });

    it('throws an error', () => {
        assertEqual('getObjectHeaders', error.message);
    });
});

describe('ObjectStore:putObjectMetadata() missing object headers', ({ before, after, it }) => {
    let sandbox;
    let objectStore;
    let db;
    const objectId = 'an-object-123';
    const referenceId = 'some-image.jpg';
    const document = {};
    let error;

    before(async () => {
        sandbox = sinon.createSandbox();

        db = {
            getObjectHeaders: sinon.fake.resolves(null),
            putObjectMetadata: sinon.fake.resolves(),
        };

        const lockingQueue = null;

        objectStore = new ObjectStore({ lockingQueue, db });

        sandbox.replace(objectStore, 'getLock', sinon.fake.resolves());
        sandbox.replace(objectStore, 'releaseLock', sinon.fake.returns());

        try {
            await objectStore.putObjectMetadata(objectId, referenceId, document);
        } catch (e) {
            error = e;
        }
    });

    after(() => {
        if (sandbox) {
            sandbox.restore();
        }
    });

    it('gets a resource lock', () => {
        assertEqual(1, objectStore.getLock.callCount);
    });

    it('calls engine getObjectHeaders()', () => {
        assertEqual(1, db.getObjectHeaders.callCount);
        assertEqual(objectId, db.getObjectHeaders.firstCall.args[0]);
    });

    it('releases the resource lock', () => {
        assertEqual(1, objectStore.releaseLock.callCount);
    });

    it('throws a BadRequestError', () => {
        assertEqual('BadRequestError', error.name);
    });
});

describe('ObjectStore:putObjectMetadata()', ({ before, after, it }) => {
    let sandbox;
    let objectStore;
    let db;
    const objectId = 'an-object-123';
    const referenceId = 'some-image.jpg';
    const document = {};

    before(async () => {
        sandbox = sinon.createSandbox();

        db = {
            getObjectHeaders: sinon.fake.resolves(new Headers()),
            putObjectMetadata: sinon.fake.resolves(),
        };

        const lockingQueue = null;

        objectStore = new ObjectStore({ lockingQueue, db });

        sandbox.replace(objectStore, 'getLock', sinon.fake.resolves());
        sandbox.replace(objectStore, 'releaseLock', sinon.fake.returns());

        await objectStore.putObjectMetadata(objectId, referenceId, document);
    });

    after(() => {
        if (sandbox) {
            sandbox.restore();
        }
    });

    it('gets a resource lock', () => {
        assertEqual(1, objectStore.getLock.callCount);
    });

    it('calls engine getObjectHeaders()', () => {
        assertEqual(1, db.getObjectHeaders.callCount);
        assertEqual(objectId, db.getObjectHeaders.firstCall.args[0]);
    });

    it('calls engine putObjectMetadata()', () => {
        assertEqual(1, db.putObjectMetadata.callCount);
        assertEqual(objectId, db.putObjectMetadata.firstCall.args[0]);
        assertEqual(referenceId, db.putObjectMetadata.firstCall.args[1]);
        assertEqual(document, db.putObjectMetadata.firstCall.args[2]);
    });

    it('releases the resource lock', () => {
        assertEqual(1, objectStore.releaseLock.callCount);
    });
});
