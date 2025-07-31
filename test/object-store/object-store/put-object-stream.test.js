import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';
import ObjectStore from '../../../lib/object-store/object-store.js';


describe('ObjectStore:putObjectStream() engine throws', ({ before, after, it }) => {
    let sandbox;
    let objectStore;
    let db;
    const sourceStream = {};
    const headers = new Headers();
    let error;

    before(async () => {
        sandbox = sinon.createSandbox();

        db = {
            putObjectStream: sinon.fake.rejects(new Error('putObjectStream')),
        };

        const lockingQueue = null;

        objectStore = new ObjectStore({ lockingQueue, db });

        sandbox.replace(objectStore, 'getLock', sinon.fake.resolves());
        sandbox.replace(objectStore, 'releaseLock', sinon.fake.returns());

        try {
            await objectStore.putObjectStream(sourceStream, headers);
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

    it('calls engine putObjectStream()', () => {
        assertEqual(1, db.putObjectStream.callCount);
        assertEqual(sourceStream, db.putObjectStream.firstCall.args[0]);
        assertEqual(headers, db.putObjectStream.firstCall.args[1]);
    });

    it('releases the resource lock', () => {
        assertEqual(1, objectStore.releaseLock.callCount);
    });

    it('throws an error', () => {
        assertEqual('putObjectStream', error.message);
    });
});

describe('ObjectStore:putObjectStream()', ({ before, after, it }) => {
    let sandbox;
    let objectStore;
    let db;
    const sourceStream = {};
    const headers = new Headers();
    const newHeaders = new Headers();
    let returnValue;

    before(async () => {
        sandbox = sinon.createSandbox();

        db = {
            putObjectStream: sinon.fake.resolves(newHeaders),
        };

        const lockingQueue = null;

        objectStore = new ObjectStore({ lockingQueue, db });

        sandbox.replace(objectStore, 'getLock', sinon.fake.resolves());
        sandbox.replace(objectStore, 'releaseLock', sinon.fake.returns());

        returnValue = await objectStore.putObjectStream(sourceStream, headers);
    });

    after(() => {
        if (sandbox) {
            sandbox.restore();
        }
    });

    it('gets a resource lock', () => {
        assertEqual(1, objectStore.getLock.callCount);
    });

    it('calls engine putObjectStream()', () => {
        assertEqual(1, db.putObjectStream.callCount);
        assertEqual(sourceStream, db.putObjectStream.firstCall.args[0]);
        assertEqual(headers, db.putObjectStream.firstCall.args[1]);
    });

    it('releases the resource lock', () => {
        assertEqual(1, objectStore.releaseLock.callCount);
    });

    it('returns the result of engine putObjectStream()', () => {
        assertEqual(newHeaders, returnValue);
    });
});
