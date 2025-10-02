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

    it('sets exclusiveEndIndex', () => {
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

describe('queryKeys() when range matches limit', ({ before, after, it }) => {
    let result;

    const index = [
        { key: 'alpha__a', documentKey: 'alpha__a' },
        { key: 'alpha__b', documentKey: 'alpha__b' },
        { key: 'alpha__c', documentKey: 'alpha__c' },
        { key: 'bar__a', documentKey: 'bar__a' },
        { key: 'bar__b', documentKey: 'bar__b' },
        { key: 'bar__c', documentKey: 'bar__c' },
        { key: 'bar__d', documentKey: 'bar__d' },
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

    it('sets exclusiveEndIndex', () => {
        const { exclusiveEndIndex } = result;
        assertEqual(null, exclusiveEndIndex);
    });

    it('returns expected items', () => {
        const { items } = result;
        assertEqual(4, items.length);
        assertEqual('bar__a', items[0].key);
        assertEqual('bar__b', items[1].key);
        assertEqual('bar__c', items[2].key);
        assertEqual('bar__d', items[3].key);
    });
});

describe('queryKeys() when range is outside limit', ({ before, after, it }) => {
    let result;

    const index = [
        { key: 'alpha__a', documentKey: 'alpha__a' },
        { key: 'alpha__b', documentKey: 'alpha__b' },
        { key: 'alpha__c', documentKey: 'alpha__c' },
        { key: 'bar__a', documentKey: 'bar__a' },
        { key: 'bar__b', documentKey: 'bar__b' },
        { key: 'bar__c', documentKey: 'bar__c' },
        { key: 'bar__d', documentKey: 'bar__d' },
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
            limit: 3,
            includeDocuments: false,
        });
    });

    after(() => {
        sinon.restore();
    });

    it('sets exclusiveEndIndex', () => {
        const { exclusiveEndIndex } = result;
        assertEqual(3, exclusiveEndIndex);
    });

    it('returns expected items', () => {
        const { items } = result;
        assertEqual(3, items.length);
        assertEqual('bar__a', items[0].key);
        assertEqual('bar__b', items[1].key);
        assertEqual('bar__c', items[2].key);
    });
});

describe('queryKeys() with pagination at limit', ({ before, after, it }) => {
    let page1;
    let page2;

    const index = [
        { key: 'alpha__a', documentKey: 'alpha__a' },
        { key: 'alpha__b', documentKey: 'alpha__b' },
        { key: 'alpha__c', documentKey: 'alpha__c' },
        { key: 'bar__a', documentKey: 'bar__a' },
        { key: 'bar__b', documentKey: 'bar__b' },
        { key: 'bar__c', documentKey: 'bar__c' },
        { key: 'bar__d', documentKey: 'bar__d' },
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

        page1 = engine.queryKeys({
            descending: false,
            inclusiveStartIndex: 0,
            startKey: `bar__${ ALPHA }`,
            endKey: `bar__${ OMEGA }`,
            limit: 2,
            includeDocuments: false,
        });

        page2 = engine.queryKeys({
            descending: false,
            inclusiveStartIndex: page1.exclusiveEndIndex,
            startKey: `bar__${ ALPHA }`,
            endKey: `bar__${ OMEGA }`,
            limit: 2,
            includeDocuments: false,
        });
    });

    after(() => {
        sinon.restore();
    });

    it('sets exclusiveEndIndex', () => {
        const { exclusiveEndIndex } = page2;
        assertEqual(null, exclusiveEndIndex);
    });

    it('returns expected items', () => {
        assertEqual(2, page1.items.length);
        assertEqual(2, page2.items.length);
        assertEqual('bar__a', page1.items[0].key);
        assertEqual('bar__b', page1.items[1].key);
        assertEqual('bar__c', page2.items[0].key);
        assertEqual('bar__d', page2.items[1].key);
    });
});

describe('queryKeys() with pagination outside limit', ({ before, after, it }) => {
    let page1;
    let page2;

    const index = [
        { key: 'alpha__a', documentKey: 'alpha__a' },
        { key: 'alpha__b', documentKey: 'alpha__b' },
        { key: 'alpha__c', documentKey: 'alpha__c' },
        { key: 'bar__a', documentKey: 'bar__a' },
        { key: 'bar__b', documentKey: 'bar__b' },
        { key: 'bar__c', documentKey: 'bar__c' },
        { key: 'bar__d', documentKey: 'bar__d' },
        { key: 'bar__e', documentKey: 'bar__e' },
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

        page1 = engine.queryKeys({
            descending: false,
            inclusiveStartIndex: 0,
            startKey: `bar__${ ALPHA }`,
            endKey: `bar__${ OMEGA }`,
            limit: 2,
            includeDocuments: false,
        });

        page2 = engine.queryKeys({
            descending: false,
            inclusiveStartIndex: page1.exclusiveEndIndex,
            startKey: `bar__${ ALPHA }`,
            endKey: `bar__${ OMEGA }`,
            limit: 2,
            includeDocuments: false,
        });
    });

    after(() => {
        sinon.restore();
    });

    it('sets exclusiveEndIndex', () => {
        const { exclusiveEndIndex } = page2;
        assertEqual(4, exclusiveEndIndex);
    });

    it('returns expected items', () => {
        assertEqual(2, page1.items.length);
        assertEqual(2, page2.items.length);
        assertEqual('bar__a', page1.items[0].key);
        assertEqual('bar__b', page1.items[1].key);
        assertEqual('bar__c', page2.items[0].key);
        assertEqual('bar__d', page2.items[1].key);
    });
});

describe('queryKeys() with pagination inside limit', ({ before, after, it }) => {
    let page1;
    let page2;

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

        page1 = engine.queryKeys({
            descending: false,
            inclusiveStartIndex: 0,
            startKey: `bar__${ ALPHA }`,
            endKey: `bar__${ OMEGA }`,
            limit: 2,
            includeDocuments: false,
        });

        page2 = engine.queryKeys({
            descending: false,
            inclusiveStartIndex: page1.exclusiveEndIndex,
            startKey: `bar__${ ALPHA }`,
            endKey: `bar__${ OMEGA }`,
            limit: 2,
            includeDocuments: false,
        });
    });

    after(() => {
        sinon.restore();
    });

    it('sets exclusiveEndIndex', () => {
        const { exclusiveEndIndex } = page2;
        assertEqual(null, exclusiveEndIndex);
    });

    it('returns expected items', () => {
        assertEqual(2, page1.items.length);
        assertEqual(1, page2.items.length);
        assertEqual('bar__a', page1.items[0].key);
        assertEqual('bar__b', page1.items[1].key);
        assertEqual('bar__c', page2.items[0].key);
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

    it('sets exclusiveEndIndex', () => {
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

describe('queryView() when range matches limit', ({ before, after, it }) => {
    let result;

    const index = [
        { key: 'alpha__a', documentKey: '1' },
        { key: 'alpha__b', documentKey: '2' },
        { key: 'alpha__c', documentKey: '3' },
        { key: 'bar__a', documentKey: '4' },
        { key: 'bar__b', documentKey: '6' },
        { key: 'bar__c', documentKey: '7' },
        { key: 'bar__d', documentKey: '8' },
        { key: 'foo__a', documentKey: '9' },
        { key: 'foo__b', documentKey: '10' },
        { key: 'foo__c', documentKey: '11' },
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

    it('sets exclusiveEndIndex', () => {
        const { exclusiveEndIndex } = result;
        assertEqual(null, exclusiveEndIndex);
    });

    it('returns expected items', () => {
        const { items } = result;
        assertEqual(4, items.length);
        assertEqual('bar__a', items[0].key);
        assertEqual('bar__b', items[1].key);
        assertEqual('bar__c', items[2].key);
        assertEqual('bar__d', items[3].key);
    });
});

describe('queryView() when range is outside limit', ({ before, after, it }) => {
    let result;

    const index = [
        { key: 'alpha__a', documentKey: '1' },
        { key: 'alpha__b', documentKey: '2' },
        { key: 'alpha__c', documentKey: '3' },
        { key: 'bar__a', documentKey: '4' },
        { key: 'bar__b', documentKey: '6' },
        { key: 'bar__c', documentKey: '7' },
        { key: 'bar__d', documentKey: '8' },
        { key: 'foo__a', documentKey: '9' },
        { key: 'foo__b', documentKey: '10' },
        { key: 'foo__c', documentKey: '11' },
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
            limit: 3,
            includeDocuments: false,
        });
    });

    after(() => {
        sinon.restore();
    });

    it('sets exclusiveEndIndex', () => {
        const { exclusiveEndIndex } = result;
        assertEqual(3, exclusiveEndIndex);
    });

    it('returns expected items', () => {
        const { items } = result;
        assertEqual(3, items.length);
        assertEqual('bar__a', items[0].key);
        assertEqual('bar__b', items[1].key);
        assertEqual('bar__c', items[2].key);
    });
});

describe('queryView() with pagination at limit', ({ before, after, it }) => {
    let page1;
    let page2;

    const index = [
        { key: 'alpha__a', documentKey: '1' },
        { key: 'alpha__b', documentKey: '2' },
        { key: 'alpha__c', documentKey: '3' },
        { key: 'bar__a', documentKey: '4' },
        { key: 'bar__b', documentKey: '6' },
        { key: 'bar__c', documentKey: '7' },
        { key: 'bar__d', documentKey: '8' },
        { key: 'foo__a', documentKey: '9' },
        { key: 'foo__b', documentKey: '10' },
        { key: 'foo__c', documentKey: '11' },
    ];

    before(async () => {
        const mockFileSystem = {};

        const engine = new DatastoreEngine({
            directory: CURRENT_WORKING_DIRECTORY,
            fileSystem: mockFileSystem,
        });

        engine.setView('by_type', {});

        sinon.stub(engine, 'mapViewDocuments').returns(index);

        page1 = engine.queryView('by_type', {
            descending: false,
            inclusiveStartIndex: 0,
            startKey: `bar__${ ALPHA }`,
            endKey: `bar__${ OMEGA }`,
            limit: 2,
            includeDocuments: false,
        });

        page2 = engine.queryView('by_type', {
            descending: false,
            inclusiveStartIndex: page1.exclusiveEndIndex,
            startKey: `bar__${ ALPHA }`,
            endKey: `bar__${ OMEGA }`,
            limit: 2,
            includeDocuments: false,
        });
    });

    after(() => {
        sinon.restore();
    });

    it('sets exclusiveEndIndex', () => {
        const { exclusiveEndIndex } = page2;
        assertEqual(null, exclusiveEndIndex);
    });

    it('returns expected items', () => {
        assertEqual(2, page1.items.length);
        assertEqual(2, page2.items.length);
        assertEqual('bar__a', page1.items[0].key);
        assertEqual('bar__b', page1.items[1].key);
        assertEqual('bar__c', page2.items[0].key);
        assertEqual('bar__d', page2.items[1].key);
    });
});

describe('queryView() with pagination outside limit', ({ before, after, it }) => {
    let page1;
    let page2;

    const index = [
        { key: 'alpha__a', documentKey: '1' },
        { key: 'alpha__b', documentKey: '2' },
        { key: 'alpha__c', documentKey: '3' },
        { key: 'bar__a', documentKey: '4' },
        { key: 'bar__b', documentKey: '6' },
        { key: 'bar__c', documentKey: '7' },
        { key: 'bar__d', documentKey: '8' },
        { key: 'bar__e', documentKey: '9' },
        { key: 'foo__a', documentKey: '10' },
        { key: 'foo__b', documentKey: '11' },
        { key: 'foo__c', documentKey: '12' },
    ];

    before(async () => {
        const mockFileSystem = {};

        const engine = new DatastoreEngine({
            directory: CURRENT_WORKING_DIRECTORY,
            fileSystem: mockFileSystem,
        });

        engine.setView('by_type', {});

        sinon.stub(engine, 'mapViewDocuments').returns(index);

        page1 = engine.queryView('by_type', {
            descending: false,
            inclusiveStartIndex: 0,
            startKey: `bar__${ ALPHA }`,
            endKey: `bar__${ OMEGA }`,
            limit: 2,
            includeDocuments: false,
        });

        page2 = engine.queryView('by_type', {
            descending: false,
            inclusiveStartIndex: page1.exclusiveEndIndex,
            startKey: `bar__${ ALPHA }`,
            endKey: `bar__${ OMEGA }`,
            limit: 2,
            includeDocuments: false,
        });
    });

    after(() => {
        sinon.restore();
    });

    it('sets exclusiveEndIndex', () => {
        const { exclusiveEndIndex } = page2;
        assertEqual(4, exclusiveEndIndex);
    });

    it('returns expected items', () => {
        assertEqual(2, page1.items.length);
        assertEqual(2, page2.items.length);
        assertEqual('bar__a', page1.items[0].key);
        assertEqual('bar__b', page1.items[1].key);
        assertEqual('bar__c', page2.items[0].key);
        assertEqual('bar__d', page2.items[1].key);
    });
});

describe('queryView() with pagination inside limit', ({ before, after, it }) => {
    let page1;
    let page2;

    const index = [
        { key: 'alpha__a', documentKey: '1' },
        { key: 'alpha__b', documentKey: '2' },
        { key: 'alpha__c', documentKey: '3' },
        { key: 'bar__a', documentKey: '4' },
        { key: 'bar__b', documentKey: '6' },
        { key: 'bar__c', documentKey: '7' },
        { key: 'foo__a', documentKey: '9' },
        { key: 'foo__b', documentKey: '10' },
        { key: 'foo__c', documentKey: '11' },
    ];

    before(async () => {
        const mockFileSystem = {};

        const engine = new DatastoreEngine({
            directory: CURRENT_WORKING_DIRECTORY,
            fileSystem: mockFileSystem,
        });

        engine.setView('by_type', {});

        sinon.stub(engine, 'mapViewDocuments').returns(index);

        page1 = engine.queryView('by_type', {
            descending: false,
            inclusiveStartIndex: 0,
            startKey: `bar__${ ALPHA }`,
            endKey: `bar__${ OMEGA }`,
            limit: 2,
            includeDocuments: false,
        });

        page2 = engine.queryView('by_type', {
            descending: false,
            inclusiveStartIndex: page1.exclusiveEndIndex,
            startKey: `bar__${ ALPHA }`,
            endKey: `bar__${ OMEGA }`,
            limit: 2,
            includeDocuments: false,
        });
    });

    after(() => {
        sinon.restore();
    });

    it('sets exclusiveEndIndex', () => {
        const { exclusiveEndIndex } = page2;
        assertEqual(null, exclusiveEndIndex);
    });

    it('returns expected items', () => {
        assertEqual(2, page1.items.length);
        assertEqual(1, page2.items.length);
        assertEqual('bar__a', page1.items[0].key);
        assertEqual('bar__b', page1.items[1].key);
        assertEqual('bar__c', page2.items[0].key);
    });
});
