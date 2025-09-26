import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';

import DatastoreEngine from '../../lib/datastore/datastore-engine.js';

import { ALPHA, OMEGA } from '../../lib/lib/constants.js';

// Mock current working directory
const CURRENT_WORKING_DIRECTORY = path.dirname(fileURLToPath(new URL(import.meta.url)));


describe('queryKeys() when range is within limit', ({ before, after, it }) => {
    let result;

    const index = [
        { key: 'alpha__a', documentKey: 'alpha__a' },
        { key: 'alpha__b', documentKey: 'alpha__b' },
        { key: 'alpha__c', documentKey: 'alpha__c' },
        { key: 'bar__a', documentKey: 'bar__a' },
        { key: 'bar__b', documentKey: 'bar__b' },
        { key: 'bar__c', documentKey: 'bar__c' },
        { key: 'foo__a', documentKey: 'foo__a' },
        { key: 'foo__b', documentKey: 'foo__b' },
        { key: 'foo__c', documentKey: 'foo__c' },
    ];

    before(async () => {
        const mockFileSystem = {};

        const engine = new DatastoreEngine({
            directory: CURRENT_WORKING_DIRECTORY,
            fileSystem: mockFileSystem,
        });

        sinon.stub(engine, 'mapDocumentKeys').returns(index);

        result = engine.queryKeys({
            descending: false,
            inclusiveStartIndex: 0,
            startKey: `bar__${ ALPHA }`,
            endKey: `bar__${ OMEGA }`,
            limit: 4,
            includeDocuments: false,
        });
    });

    after(() => {
        sinon.restore();
    });

    it('sets exclusiveEndIndex to null', () => {
        const { exclusiveEndIndex } = result;
        assertEqual(null, exclusiveEndIndex);
    });

    it('returns expected items', () => {
        const { items } = result;
        assertEqual(3, items.length);
        assertEqual('bar__a', items[0].key);
        assertEqual('bar__b', items[1].key);
        assertEqual('bar__c', items[2].key);
    });
});


describe('queryView() when range is within limit', ({ before, after, it }) => {
    let result;

    const index = [
        { key: 'alpha__a', documentKey: '1' },
        { key: 'alpha__b', documentKey: '2' },
        { key: 'alpha__c', documentKey: '3' },
        { key: 'bar__a', documentKey: '4' },
        { key: 'bar__b', documentKey: '6' },
        { key: 'bar__c', documentKey: '7' },
        { key: 'foo__a', documentKey: '8' },
        { key: 'foo__b', documentKey: '9' },
        { key: 'foo__c', documentKey: '10' },
    ];

    before(async () => {
        const mockFileSystem = {};

        const engine = new DatastoreEngine({
            directory: CURRENT_WORKING_DIRECTORY,
            fileSystem: mockFileSystem,
        });

        engine.setView('by_type', {});

        sinon.stub(engine, 'mapViewDocuments').returns(index);

        result = engine.queryView('by_type', {
            descending: false,
            inclusiveStartIndex: 0,
            startKey: `bar__${ ALPHA }`,
            endKey: `bar__${ OMEGA }`,
            limit: 4,
            includeDocuments: false,
        });
    });

    after(() => {
        sinon.restore();
    });

    it('sets exclusiveEndIndex to null', () => {
        const { exclusiveEndIndex } = result;
        assertEqual(null, exclusiveEndIndex);
    });

    it('returns expected items', () => {
        const { items } = result;
        assertEqual(3, items.length);
        assertEqual('bar__a', items[0].key);
        assertEqual('bar__b', items[1].key);
        assertEqual('bar__c', items[2].key);
    });
});
