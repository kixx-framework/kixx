import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';
import ObjectStore from '../../object-store/object-store.js';


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

