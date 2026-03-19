import { describe } from 'kixx-test';
import { assertEqual, assert, assertMatches } from 'kixx-assert';
import { WrappedError } from '../../../lib/errors.js';
import {
    DataStoreClosedError,
    DataStoreNotInitializedError,
    DocumentAlreadyExistsError,
    DocumentNotFoundError,
    VersionConflictError,
    IndexNotConfiguredError
} from '../../../lib/datastore/errors.js';


describe('DataStoreNotInitializedError', ({ it }) => {
    const err = new DataStoreNotInitializedError('query');

    it('name is DataStoreNotInitializedError', () => {
        assertEqual('DataStoreNotInitializedError', err.name);
    });
    it('code is DATASTORE_NOT_INITIALIZED', () => {
        assertEqual('DATASTORE_NOT_INITIALIZED', err.code);
    });
    it('operation property', () => {
        assertEqual('query', err.operation);
    });
});

describe('DataStoreClosedError', ({ it }) => {
    const err = new DataStoreClosedError('get');

    it('name is DataStoreClosedError', () => {
        assertEqual('DataStoreClosedError', err.name);
    });
    it('code is DATASTORE_CLOSED', () => {
        assertEqual('DATASTORE_CLOSED', err.code);
    });
    it('operation property', () => {
        assertEqual('get', err.operation);
    });
});

describe('DocumentAlreadyExistsError', ({ it }) => {
    const err = new DocumentAlreadyExistsError('Customer', 'cust_001');

    it('name is DocumentAlreadyExistsError', () => {
        assertEqual('DocumentAlreadyExistsError', err.name);
    });
    it('code is DOCUMENT_EXISTS', () => {
        assertEqual('DOCUMENT_EXISTS', err.code);
    });
    it('expected is true', () => {
        assertEqual(true, err.expected);
    });
    it('is an instance of WrappedError', () => {
        assert(err instanceof WrappedError);
    });
    it('message includes type and id', () => {
        assertMatches('Customer', err.message);
        assertMatches('cust_001', err.message);
    });
    it('type property', () => {
        assertEqual('Customer', err.type);
    });
    it('id property', () => {
        assertEqual('cust_001', err.id);
    });
});

describe('DocumentNotFoundError', ({ it }) => {
    const err = new DocumentNotFoundError('Order', 'ord_42');

    it('name is DocumentNotFoundError', () => {
        assertEqual('DocumentNotFoundError', err.name);
    });
    it('code is DOCUMENT_NOT_FOUND', () => {
        assertEqual('DOCUMENT_NOT_FOUND', err.code);
    });
    it('expected is true', () => {
        assertEqual(true, err.expected);
    });
    it('is an instance of WrappedError', () => {
        assert(err instanceof WrappedError);
    });
    it('message includes type and id', () => {
        assertMatches('Order', err.message);
        assertMatches('ord_42', err.message);
    });
    it('type property', () => {
        assertEqual('Order', err.type);
    });
    it('id property', () => {
        assertEqual('ord_42', err.id);
    });
});

describe('VersionConflictError', ({ it }) => {
    const err = new VersionConflictError('Product', 'prod_7', 3, 5);

    it('name is VersionConflictError', () => {
        assertEqual('VersionConflictError', err.name);
    });
    it('code is VERSION_CONFLICT', () => {
        assertEqual('VERSION_CONFLICT', err.code);
    });
    it('expected is true', () => {
        assertEqual(true, err.expected);
    });
    it('is an instance of WrappedError', () => {
        assert(err instanceof WrappedError);
    });
    it('type property', () => {
        assertEqual('Product', err.type);
    });
    it('id property', () => {
        assertEqual('prod_7', err.id);
    });
    it('expectedVersion property', () => {
        assertEqual(3, err.expectedVersion);
    });
    it('actualVersion property', () => {
        assertEqual(5, err.actualVersion);
    });
    it('message includes all identifiers and versions', () => {
        assertMatches('Product', err.message);
        assertMatches('prod_7', err.message);
        assertMatches('3', err.message);
        assertMatches('5', err.message);
    });
});

describe('IndexNotConfiguredError', ({ it }) => {
    const err = new IndexNotConfiguredError('Customer', 'email');

    it('name is IndexNotConfiguredError', () => {
        assertEqual('IndexNotConfiguredError', err.name);
    });
    it('code is INDEX_NOT_CONFIGURED', () => {
        assertEqual('INDEX_NOT_CONFIGURED', err.code);
    });
    it('expected is true', () => {
        assertEqual(true, err.expected);
    });
    it('is an instance of WrappedError', () => {
        assert(err instanceof WrappedError);
    });
    it('message includes type and attribute', () => {
        assertMatches('Customer', err.message);
        assertMatches('email', err.message);
    });
    it('type property', () => {
        assertEqual('Customer', err.type);
    });
    it('attribute property', () => {
        assertEqual('email', err.attribute);
    });
});
