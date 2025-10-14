import { describe } from 'kixx-test';
import sinon from 'sinon';

import {
    assert,
    assertEqual,
    assertNonEmptyString,
    assertGreaterThan
} from 'kixx-assert';

import KixxBaseUserSession from '../../lib/user/kixx-base-user-session.js';


describe('KixxBaseUserSession#refresh()', ({ before, after, it }) => {
    let originalSession;
    let genIdStub;
    let refreshedSession;

    before(() => {
        const now = new Date('2025-10-14T12:00:00.000Z');

        genIdStub = sinon.stub(KixxBaseUserSession, 'genId').returns('new-session-id');

        originalSession = new KixxBaseUserSession({
            id: 'original-id',
            userId: 'user-123',
            creationDateTime: now,
            lastRefreshDateTime: now,
        });

        refreshedSession = originalSession.refresh();
    });

    after(() => {
        sinon.restore();
    });

    it('returns a new instance of KixxBaseUserSession', () => {
        assert(refreshedSession instanceof KixxBaseUserSession, 'refreshedSession is an instance of KixxBaseUserSession');
        assert(refreshedSession !== originalSession, 'refreshedSession is not the same reference as originalSession');
    });

    it('generates a new id for the refreshed session', () => {
        assertEqual(1, genIdStub.callCount, 'genId() was called once');
        assertEqual('new-session-id', refreshedSession.id, 'refreshedSession.id is the generated ID');
    });

    it('preserves the userId from the original session', () => {
        assertEqual('user-123', refreshedSession.userId, 'userId is preserved');
    });

    it('preserves the creationDateTime from the original session', () => {
        assertEqual(originalSession.creationDateTime, refreshedSession.creationDateTime, 'creationDateTime is preserved');
    });

    it('updates the lastRefreshDateTime to the current time', () => {
        assertNonEmptyString(refreshedSession.lastRefreshDateTime.toISOString(), 'lastRefreshDateTime is not empty');
        const refreshTimestamp = refreshedSession.lastRefreshDateTime.getTime();
        assertGreaterThan(originalSession.lastRefreshDateTime.getTime(), refreshTimestamp, 'lastRefreshDateTime is updated');
    });
});

describe('KixxBaseUserSession#toRecord()', ({ before, it }) => {
    let session;
    let record;

    before(() => {
        session = new KixxBaseUserSession({
            id: 'session-123',
            userId: 'user-456',
            creationDateTime: new Date('2025-10-14T12:00:00.000Z'),
            lastRefreshDateTime: new Date('2025-10-14T13:00:00.000Z'),
        });

        record = session.toRecord();
    });

    it('returns a shallow copy of the session', () => {
        assert(record !== session, 'record is not the same reference as session');
        assertEqual('object', typeof record, 'record is an object');
    });

    it('converts creationDateTime to an ISO string', () => {
        assertNonEmptyString(record.creationDateTime, 'record.creationDateTime is not empty');
        assertEqual('2025-10-14T12:00:00.000Z', record.creationDateTime, 'creationDateTime is in ISO format');
    });

    it('converts lastRefreshDateTime to an ISO string', () => {
        assertNonEmptyString(record.lastRefreshDateTime, 'record.lastRefreshDateTime is not empty');
        assertEqual('2025-10-14T13:00:00.000Z', record.lastRefreshDateTime, 'lastRefreshDateTime is in ISO format');
    });

    it('preserves other properties without modification', () => {
        assertEqual('session-123', record.id, 'id is preserved');
        assertEqual('user-456', record.userId, 'userId is preserved');
        assertEqual('KixxBaseUserSession', record.type, 'type is preserved');
    });
});

describe('KixxBaseUserSession.fromRecord()', ({ before, it }) => {
    let record;
    let session;

    before(() => {
        record = {
            id: 'session-789',
            userId: 'user-101',
            creationDateTime: '2025-10-14T10:00:00.000Z',
            lastRefreshDateTime: '2025-10-14T11:00:00.000Z',
        };

        session = KixxBaseUserSession.fromRecord(record);
    });

    it('returns an instance of KixxBaseUserSession', () => {
        assert(session instanceof KixxBaseUserSession, 'session is an instance of KixxBaseUserSession');
        assertEqual('KixxBaseUserSession', session.type, 'session type is KixxBaseUserSession');
    });

    it('assigns the id from the record', () => {
        assertEqual('session-789', session.id, 'session.id matches the record');
    });

    it('assigns the userId from the record', () => {
        assertEqual('user-101', session.userId, 'session.userId matches the record');
    });

    it('converts creationDateTime from ISO string to Date', () => {
        assert(session.creationDateTime instanceof Date, 'creationDateTime is a Date');
        assertEqual('2025-10-14T10:00:00.000Z', session.creationDateTime.toISOString(), 'creationDateTime value is correct');
    });

    it('converts lastRefreshDateTime from ISO string to Date', () => {
        assert(session.lastRefreshDateTime instanceof Date, 'lastRefreshDateTime is a Date');
        assertEqual('2025-10-14T11:00:00.000Z', session.lastRefreshDateTime.toISOString(), 'lastRefreshDateTime value is correct');
    });
});

describe('KixxBaseUserSession.create()', ({ before, after, it }) => {
    let genIdStub;
    let session;

    before(() => {
        genIdStub = sinon.stub(KixxBaseUserSession, 'genId').returns('created-session-id');

        session = KixxBaseUserSession.create({ userId: 'user-999' });
    });

    after(() => {
        sinon.restore();
    });

    it('calls genId() to generate an ID', () => {
        assertEqual(1, genIdStub.callCount, 'genId() was called once');
    });

    it('returns an instance of KixxBaseUserSession', () => {
        assert(session instanceof KixxBaseUserSession, 'session is an instance of KixxBaseUserSession');
        assertEqual('KixxBaseUserSession', session.type, 'session type is KixxBaseUserSession');
    });

    it('assigns the generated ID to the session', () => {
        assertEqual('created-session-id', session.id, 'session.id is the generated ID');
    });

    it('assigns the userId from props', () => {
        assertEqual('user-999', session.userId, 'session.userId matches the provided userId');
    });

    it('sets creationDateTime to the current time', () => {
        assert(session.creationDateTime instanceof Date, 'creationDateTime is a Date');
    });

    it('sets lastRefreshDateTime to the current time', () => {
        assert(session.lastRefreshDateTime instanceof Date, 'lastRefreshDateTime is a Date');
    });

    it('sets creationDateTime and lastRefreshDateTime to the same value', () => {
        assertEqual(session.creationDateTime.getTime(), session.lastRefreshDateTime.getTime(), 'both dates have the same timestamp');
    });
});

