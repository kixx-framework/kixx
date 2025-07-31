import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';
import ObjectStore from '../../../lib/object-store/object-store.js';


describe('ObjectStore:getObjectStreamByReference() getObjectResponse error', ({ before, after, it }) => {
    let sandbox;
    let objectStore;
    let db;
    let error;

    before(async () => {
        sandbox = sinon.createSandbox();

        db = {
            getObjectMetadata: sinon.fake.resolves({ objectId: 'an-object-123' }),
            getObjectResponse: sinon.fake.throws(new Error('getObjectResponse')),
        };

        const lockingQueue = null;

        objectStore = new ObjectStore({ lockingQueue, db });

        sandbox.replace(objectStore, 'getLock', sinon.fake.resolves());
        sandbox.replace(objectStore, 'releaseLock', sinon.fake.returns());

        try {
            await objectStore.getObjectStreamByReference('some-image.jpg');
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

    it('gets the object id from getMetadata', () => {
        assertEqual(1, db.getObjectMetadata.callCount);
    });

    it('releases the resource lock', () => {
        assertEqual(1, objectStore.releaseLock.callCount);
    });

    it('throws an Error', () => {
        assertEqual('getObjectResponse', error.message);
    });
});

describe('ObjectStore:getObjectStreamByReference() getObjectMetadata error', ({ before, after, it }) => {
    let sandbox;
    let objectStore;
    let db;
    const responseStream = {};
    let error;

    before(async () => {
        sandbox = sinon.createSandbox();

        db = {
            getObjectMetadata: sinon.fake.throws(new Error('getObjectMetadata')),
            getObjectResponse: sinon.fake.resolves(responseStream),
        };

        const lockingQueue = null;

        objectStore = new ObjectStore({ lockingQueue, db });

        sandbox.replace(objectStore, 'getLock', sinon.fake.resolves());
        sandbox.replace(objectStore, 'releaseLock', sinon.fake.returns());

        try {
            await objectStore.getObjectStreamByReference('some-image.jpg');
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

    it('gets the object id from getMetadata', () => {
        assertEqual(1, db.getObjectMetadata.callCount);
    });

    it('releases the resource lock', () => {
        assertEqual(1, objectStore.releaseLock.callCount);
    });

    it('throws an Error', () => {
        assertEqual('getObjectMetadata', error.message);
    });
});

describe('ObjectStore:getObjectStreamByReference() no objectId', ({ before, after, it }) => {
    let sandbox;
    let objectStore;
    let db;
    const responseStream = {};
    let error;

    before(async () => {
        sandbox = sinon.createSandbox();

        db = {
            getObjectMetadata: sinon.fake.resolves({}),
            getObjectResponse: sinon.fake.resolves(responseStream),
        };

        const lockingQueue = null;

        objectStore = new ObjectStore({ lockingQueue, db });

        sandbox.replace(objectStore, 'getLock', sinon.fake.resolves());
        sandbox.replace(objectStore, 'releaseLock', sinon.fake.returns());

        try {
            await objectStore.getObjectStreamByReference('some-image.jpg');
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

    it('gets the object id from getMetadata', () => {
        assertEqual(1, db.getObjectMetadata.callCount);
        assertEqual('some-image.jpg', db.getObjectMetadata.firstCall.args[0]);
    });

    it('releases the resource lock', () => {
        assertEqual(1, objectStore.releaseLock.callCount);
    });

    it('throws an AssertionError', () => {
        assertEqual('AssertionError', error.name);
    });
});

describe('ObjectStore:getObjectStreamByReference() with metdata but no headers or object', ({ before, after, it }) => {
    let sandbox;
    let objectStore;
    let db;
    let error;

    before(async () => {
        sandbox = sinon.createSandbox();

        db = {
            getObjectMetadata: sinon.fake.resolves({ objectId: 'an-object-123' }),
            getObjectResponse: sinon.fake.resolves(null),
        };

        const lockingQueue = null;

        objectStore = new ObjectStore({ lockingQueue, db });

        sandbox.replace(objectStore, 'getLock', sinon.fake.resolves());
        sandbox.replace(objectStore, 'releaseLock', sinon.fake.returns());

        try {
            await objectStore.getObjectStreamByReference('some-image.jpg');
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

    it('gets the object id from getMetadata', () => {
        assertEqual(1, db.getObjectMetadata.callCount);
        assertEqual('some-image.jpg', db.getObjectMetadata.firstCall.args[0]);
    });

    it('passes the object id to getObjectResponse', () => {
        assertEqual(1, db.getObjectResponse.callCount);
        assertEqual('an-object-123', db.getObjectResponse.firstCall.args[0]);
    });

    it('releases the resource lock', () => {
        assertEqual(1, objectStore.releaseLock.callCount);
    });

    it('throws an AssertionError', () => {
        assertEqual('AssertionError', error.name);
    });
});

describe('ObjectStore:getObjectStreamByReference() no metdata', ({ before, after, it }) => {
    let sandbox;
    let objectStore;
    let db;
    const responseStream = {};
    let returnValue;

    before(async () => {
        sandbox = sinon.createSandbox();

        db = {
            getObjectMetadata: sinon.fake.resolves(null),
            getObjectResponse: sinon.fake.resolves(responseStream),
        };

        const lockingQueue = null;

        objectStore = new ObjectStore({ lockingQueue, db });

        sandbox.replace(objectStore, 'getLock', sinon.fake.resolves());
        sandbox.replace(objectStore, 'releaseLock', sinon.fake.returns());

        returnValue = await objectStore.getObjectStreamByReference('some-image.jpg');
    });

    after(() => {
        if (sandbox) {
            sandbox.restore();
        }
    });

    it('gets a resource lock', () => {
        assertEqual(1, objectStore.getLock.callCount);
    });

    it('gets the object id from getMetadata', () => {
        assertEqual(1, db.getObjectMetadata.callCount);
        assertEqual('some-image.jpg', db.getObjectMetadata.firstCall.args[0]);
    });

    it('releases the resource lock', () => {
        assertEqual(1, objectStore.releaseLock.callCount);
    });

    it('returns null', () => {
        assertEqual(null, returnValue);
    });
});


describe('ObjectStore:getObjectStreamByReference()', ({ before, after, it }) => {
    let sandbox;
    let objectStore;
    let db;
    const responseStream = {};
    let returnValue;

    before(async () => {
        sandbox = sinon.createSandbox();

        db = {
            getObjectMetadata: sinon.fake.resolves({ objectId: 'an-object-123' }),
            getObjectResponse: sinon.fake.resolves(responseStream),
        };

        const lockingQueue = null;

        objectStore = new ObjectStore({ lockingQueue, db });

        sandbox.replace(objectStore, 'getLock', sinon.fake.resolves());
        sandbox.replace(objectStore, 'releaseLock', sinon.fake.returns());

        returnValue = await objectStore.getObjectStreamByReference('some-image.jpg');
    });

    after(() => {
        if (sandbox) {
            sandbox.restore();
        }
    });

    it('gets a resource lock', () => {
        assertEqual(1, objectStore.getLock.callCount);
    });

    it('gets the object id from getMetadata', () => {
        assertEqual(1, db.getObjectMetadata.callCount);
        assertEqual('some-image.jpg', db.getObjectMetadata.firstCall.args[0]);
    });

    it('passes the object id to getObjectResponse', () => {
        assertEqual(1, db.getObjectResponse.callCount);
        assertEqual('an-object-123', db.getObjectResponse.firstCall.args[0]);
    });

    it('releases the resource lock', () => {
        assertEqual(1, objectStore.releaseLock.callCount);
    });

    it('returns the result of getObjectResponse', () => {
        assertEqual(responseStream, returnValue);
    });
});

