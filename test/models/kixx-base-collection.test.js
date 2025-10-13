import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';
import sinon from 'sinon';
import KixxBaseModel from '../../lib/models/kixx-base-model.js';
import KixxBaseCollection from '../../lib/models/kixx-base-collection.js';

class Product extends KixxBaseModel { }

class ProductCollection extends KixxBaseCollection {
    static Model = Product;
}


describe('KixxBaseCollection#getItem() when item exists', ({ before, after, it }) => {
    let context;
    let datastore;
    let collection;
    let result;
    let mockRecord;

    before(async () => {
        // Create mock record from datastore
        mockRecord = { id: 'prod-123', name: 'Widget', price: 9.99 };

        // Mock datastore with stubbed getItem method
        datastore = {
            getItem: sinon.stub().resolves(mockRecord),
        };

        // Mock context that provides the datastore service
        context = {
            getService: sinon.stub().returns(datastore),
        };

        // Create collection instance
        collection = new ProductCollection(context);

        // Spy on the methods we want to verify are called
        sinon.spy(collection, 'idToPrimaryKey');
        sinon.spy(Product, 'fromRecord');

        // Call the method under test
        result = await collection.getItem('prod-123');
    });

    after(() => {
        sinon.restore();
    });

    it('calls idToPrimaryKey()', () => {
        assertEqual(1, collection.idToPrimaryKey.callCount, 'idToPrimaryKey() was called once');
        assertEqual('prod-123', collection.idToPrimaryKey.firstCall.args[0], 'idToPrimaryKey() called with id');
    });

    it('calls datastore.getItem()', () => {
        assertEqual(1, datastore.getItem.callCount, 'datastore.getItem() was called once');
        assertEqual('Product__prod-123', datastore.getItem.firstCall.args[0], 'datastore.getItem() called with namespaced key');
    });

    it('calls Model.fromRecord() with the returned item', () => {
        assertEqual(1, Product.fromRecord.callCount, 'Product.fromRecord() was called once');
        assertEqual(mockRecord, Product.fromRecord.firstCall.args[0], 'Product.fromRecord() called with datastore record');
        assert(result instanceof Product, 'result is instance of Product');
        assertEqual('Product', result.type, 'result has correct type');
        assertEqual('prod-123', result.id, 'result has correct id');
        assertEqual('Widget', result.name, 'result has correct name');
        assertEqual(9.99, result.price, 'result has correct price');
    });
});

describe('KixxBaseCollection#getItem() when item does not exist', ({ before, after, it }) => {
    let context;
    let datastore;
    let collection;
    let result;

    before(async () => {
        // Mock datastore with stubbed getItem that returns null (item not found)
        datastore = {
            getItem: sinon.stub().resolves(null),
        };

        // Mock context that provides the datastore service
        context = {
            getService: sinon.stub().returns(datastore),
        };

        // Create collection instance
        collection = new ProductCollection(context);

        // Spy on the methods we want to verify are called (or not called)
        sinon.spy(collection, 'idToPrimaryKey');
        sinon.spy(Product, 'fromRecord');

        // Call the method under test
        result = await collection.getItem('nonexistent-id');
    });

    after(() => {
        sinon.restore();
    });

    it('calls idToPrimaryKey()', () => {
        assertEqual(1, collection.idToPrimaryKey.callCount, 'idToPrimaryKey() was called once');
        assertEqual('nonexistent-id', collection.idToPrimaryKey.firstCall.args[0], 'idToPrimaryKey() called with id');
    });

    it('calls datastore.getItem()', () => {
        assertEqual(1, datastore.getItem.callCount, 'datastore.getItem() was called once');
        assertEqual('Product__nonexistent-id', datastore.getItem.firstCall.args[0], 'datastore.getItem() called with namespaced key');
    });

    it('does not call Model.fromRecord()', () => {
        assertEqual(0, Product.fromRecord.callCount, 'Product.fromRecord() was not called');
    });

    it('returns null', () => {
        assertEqual(null, result, 'result is null');
    });
});

describe('KixxBaseCollection#setItem()', ({ before, after, it }) => {
    let context;
    let datastore;
    let collection;
    let product;
    let result;
    let recordFromToRecord;

    before(async () => {
        // Create a Product instance to save
        product = new Product({ id: 'prod-789', name: 'Gadget', price: 19.99 });

        // Mock datastore with stubbed setItem method
        datastore = {
            setItem: sinon.stub().resolves(),
        };

        // Mock context that provides the datastore service
        context = {
            getService: sinon.stub().returns(datastore),
        };

        // Create collection instance
        collection = new ProductCollection(context);

        // Spy on the methods we want to verify are called
        sinon.spy(collection, 'idToPrimaryKey');
        sinon.spy(product, 'toRecord');

        // Call the method under test
        result = await collection.setItem(product);

        // Capture the record that was passed to datastore.setItem
        recordFromToRecord = product.toRecord.returnValues[0];
    });

    after(() => {
        sinon.restore();
    });

    it('calls idToPrimaryKey()', () => {
        assertEqual(1, collection.idToPrimaryKey.callCount, 'idToPrimaryKey() was called once');
        assertEqual('prod-789', collection.idToPrimaryKey.firstCall.args[0], 'idToPrimaryKey() called with item.id');
    });

    it('calls item.toRecord()', () => {
        assertEqual(1, product.toRecord.callCount, 'toRecord() was called once');
    });

    it('calls datastore.setItem() with the result of item.toRecord()', () => {
        assertEqual(1, datastore.setItem.callCount, 'datastore.setItem() was called once');
        assertEqual('Product__prod-789', datastore.setItem.firstCall.args[0], 'datastore.setItem() called with namespaced key');
        assertEqual(recordFromToRecord, datastore.setItem.firstCall.args[1], 'datastore.setItem() called with record from toRecord()');
    });

    it('returns the item', () => {
        assertEqual(product, result, 'returns the same item instance');
    });
});

describe('KixxBaseCollection#updateItem()', ({ before, after, it }) => {
    let context;
    let datastore;
    let collection;
    let result;
    let mockRecord;
    let updateFunction;

    before(async () => {
        // Mock record that exists in datastore
        mockRecord = { id: 'prod-456', name: 'Widget', price: 9.99 };

        // Mock datastore with stubbed updateItem method
        datastore = {
            updateItem: sinon.stub().callsFake(async (key, updateHandler) => {
                // Call the updateHandler with the mock record and return the result
                const res = await updateHandler(mockRecord);
                return res;
            }),
        };

        // Mock context that provides the datastore service
        context = {
            getService: sinon.stub().returns(datastore),
        };

        // Create collection instance
        collection = new ProductCollection(context);

        // Spy on the methods we want to verify are called
        sinon.spy(collection, 'idToPrimaryKey');
        sinon.spy(Product, 'fromRecord');

        // Create the update function that will be passed to updateItem
        updateFunction = sinon.stub().callsFake(async (item) => {
            item.name = 'Updated Widget';
            item.price = 14.99;
            return item;
        });

        // Call the method under test
        result = await collection.updateItem('prod-456', updateFunction);
    });

    after(() => {
        sinon.restore();
    });

    it('calls idToPrimaryKey()', () => {
        assertEqual(1, collection.idToPrimaryKey.callCount, 'idToPrimaryKey() was called once');
        assertEqual('prod-456', collection.idToPrimaryKey.firstCall.args[0], 'idToPrimaryKey() called with id');
    });

    it('calls datastore.updateItem() with the expected key', () => {
        assertEqual(1, datastore.updateItem.callCount, 'datastore.updateItem() was called once');
        assertEqual('Product__prod-456', datastore.updateItem.firstCall.args[0], 'datastore.updateItem() called with namespaced key');
        assertEqual('function', typeof datastore.updateItem.firstCall.args[1], 'datastore.updateItem() called with updateHandler function');
    });

    it('calls the update function with the result of Model.fromRecord()', () => {
        assertEqual(1, updateFunction.callCount, 'updateFunction was called once');
        assert(updateFunction.firstCall.args[0] instanceof Product, 'updateFunction called with Product instance');
    });

    it('returns the result of Model.fromRecord()', () => {
        // Product.fromRecord should be called twice:
        // 1. Inside updateHandler to hydrate the record for the updateFunction
        // 2. After updateItem to hydrate the final result
        assertEqual(2, Product.fromRecord.callCount, 'Product.fromRecord() was called twice');
        assert(result instanceof Product, 'result is instance of Product');
        assertEqual('prod-456', result.id, 'result has correct id');
        assertEqual('Updated Widget', result.name, 'result has updated name');
        assertEqual(14.99, result.price, 'result has updated price');
        assertEqual('Product', result.type, 'result has correct type');
    });
});

describe('KixxBaseCollection#updateItem() when item does not exist', ({ before, after, it }) => {
    let context;
    let datastore;
    let collection;
    let error;
    let updateFunction;

    before(async () => {
        // Mock datastore with stubbed updateItem method that simulates item not found
        datastore = {
            updateItem: sinon.stub().callsFake(async (key, updateHandler) => {
                // Call the updateHandler with null (item doesn't exist)
                const res = await updateHandler(null);
                return res;
            }),
        };

        // Mock context that provides the datastore service
        context = {
            getService: sinon.stub().returns(datastore),
        };

        // Create collection instance
        collection = new ProductCollection(context);

        // Spy on the methods we want to verify are called
        sinon.spy(collection, 'idToPrimaryKey');
        sinon.spy(Product, 'fromRecord');

        // Create the update function
        updateFunction = sinon.stub().callsFake(async (item) => {
            item.name = 'Should not be called';
            return item;
        });

        // Call the method under test and capture the error
        try {
            await collection.updateItem('nonexistent-id', updateFunction);
        } catch (e) {
            error = e;
        }
    });

    after(() => {
        sinon.restore();
    });

    it('calls idToPrimaryKey()', () => {
        assertEqual(1, collection.idToPrimaryKey.callCount, 'idToPrimaryKey() was called once');
        assertEqual('nonexistent-id', collection.idToPrimaryKey.firstCall.args[0], 'idToPrimaryKey() called with id');
    });

    it('calls datastore.updateItem()', () => {
        assertEqual(1, datastore.updateItem.callCount, 'datastore.updateItem() was called once');
        assertEqual('Product__nonexistent-id', datastore.updateItem.firstCall.args[0], 'datastore.updateItem() called with namespaced key');
    });

    it('does not call the update function', () => {
        assertEqual(0, updateFunction.callCount, 'updateFunction was not called');
    });

    it('does not call Model.fromRecord()', () => {
        assertEqual(0, Product.fromRecord.callCount, 'Product.fromRecord() was not called');
    });

    it('throws a NotFoundError', () => {
        assert(error, 'error was thrown');
        assertEqual('NotFoundError', error.name, 'error.name');
        assertEqual('NOT_FOUND_ERROR', error.code, 'error.code');
        assertEqual(404, error.httpStatusCode, 'error.httpStatusCode');
        assertMatches('Product', error.message, 'error message contains type');
        assertMatches('nonexistent-id', error.message, 'error message contains id');
    });
});

describe('KixxBaseCollection#deleteItem()', ({ before, after, it }) => {
    let context;
    let datastore;
    let collection;
    let result;

    before(async () => {
        // Mock datastore with stubbed deleteItem method
        datastore = {
            deleteItem: sinon.stub().resolves(),
        };

        // Mock context that provides the datastore service
        context = {
            getService: sinon.stub().returns(datastore),
        };

        // Create collection instance
        collection = new ProductCollection(context);

        // Spy on idToPrimaryKey
        sinon.spy(collection, 'idToPrimaryKey');

        // Call the method under test
        result = await collection.deleteItem('prod-999');
    });

    after(() => {
        sinon.restore();
    });

    it('calls idToPrimaryKey()', () => {
        assertEqual(1, collection.idToPrimaryKey.callCount, 'idToPrimaryKey() was called once');
        assertEqual('prod-999', collection.idToPrimaryKey.firstCall.args[0], 'idToPrimaryKey() called with id');
    });

    it('calls datastore.deleteItem()', () => {
        assertEqual(1, datastore.deleteItem.callCount, 'datastore.deleteItem() was called once');
        assertEqual('Product__prod-999', datastore.deleteItem.firstCall.args[0], 'datastore.deleteItem() called with namespaced key');
    });

    it('returns the id', () => {
        assertEqual('prod-999', result, 'returns the id');
    });
});

describe('KixxBaseCollection#scanItems() when startKey and endKey are provided', ({ before, after, it }) => {
    let context;
    let datastore;
    let collection;
    let result;
    let mockQueryResult;

    before(async () => {
        // Mock datastore result with items
        mockQueryResult = {
            items: [
                { document: { id: 'prod-200', name: 'Widget', price: 9.99 } },
                { document: { id: 'prod-300', name: 'Gadget', price: 19.99 } },
            ],
        };

        // Mock datastore with stubbed queryKeys method
        datastore = {
            queryKeys: sinon.stub().resolves(mockQueryResult),
        };

        // Mock context that provides the datastore service
        context = {
            getService: sinon.stub().returns(datastore),
        };

        // Create collection instance
        collection = new ProductCollection(context);

        // Spy on the methods we want to verify are called
        sinon.spy(collection, 'idToPrimaryKey');
        sinon.spy(Product, 'fromRecord');

        // Call the method under test with explicit startKey and endKey
        result = await collection.scanItems({ startKey: 'prod-200', endKey: 'prod-400' });
    });

    after(() => {
        sinon.restore();
    });

    it('calls idToPrimaryKey()', () => {
        assertEqual(2, collection.idToPrimaryKey.callCount, 'idToPrimaryKey() was called twice (for startKey and endKey)');
        assertEqual('prod-200', collection.idToPrimaryKey.firstCall.args[0], 'first call with startKey');
        assertEqual('prod-400', collection.idToPrimaryKey.secondCall.args[0], 'second call with endKey');
    });

    it('calls datastore.queryKeys() with expected startKey, endKey, and includeDocuments set to true', () => {
        assertEqual(1, datastore.queryKeys.callCount, 'datastore.queryKeys() was called once');
        const queryParams = datastore.queryKeys.firstCall.args[0];
        assertEqual(true, queryParams.includeDocuments, 'includeDocuments is true');
        assertEqual('Product__prod-200', queryParams.startKey, 'startKey is namespaced');
        assertEqual('Product__prod-400', queryParams.endKey, 'endKey is namespaced');
    });

    it('returns the result of Model.fromRecord() for each returned item', () => {
        assertEqual(2, Product.fromRecord.callCount, 'Product.fromRecord() was called twice');
        assertEqual(2, result.items.length, 'result has 2 items');
        assert(result.items[0] instanceof Product, 'first item is instance of Product');
        assertEqual('prod-200', result.items[0].id, 'first item has correct id');
        assertEqual('Widget', result.items[0].name, 'first item has correct name');
        assert(result.items[1] instanceof Product, 'second item is instance of Product');
        assertEqual('prod-300', result.items[1].id, 'second item has correct id');
        assertEqual('Gadget', result.items[1].name, 'second item has correct name');
    });
});

describe('KixxBaseCollection#scanItems() using default startKey and endKey for ascending scans', ({ before, after, it }) => {
    let context;
    let datastore;
    let collection;
    let result;
    let mockQueryResult;

    before(async () => {
        // Mock datastore result with items
        mockQueryResult = {
            items: [
                { document: { id: 'prod-100', name: 'First', price: 5.99 } },
                { document: { id: 'prod-500', name: 'Last', price: 99.99 } },
            ],
        };

        // Mock datastore with stubbed queryKeys method
        datastore = {
            queryKeys: sinon.stub().resolves(mockQueryResult),
        };

        // Mock context that provides the datastore service
        context = {
            getService: sinon.stub().returns(datastore),
        };

        // Create collection instance
        collection = new ProductCollection(context);

        // Spy on the methods we want to verify are called
        sinon.spy(collection, 'idToPrimaryKey');
        sinon.spy(Product, 'fromRecord');

        // Call the method under test with no startKey/endKey (ascending by default)
        result = await collection.scanItems({});
    });

    after(() => {
        sinon.restore();
    });

    it('calls idToPrimaryKey()', () => {
        // Should be called twice: once for default startKey (ALPHA), once for default endKey (OMEGA)
        assertEqual(2, collection.idToPrimaryKey.callCount, 'idToPrimaryKey() was called twice');
        assertEqual('\u0000', collection.idToPrimaryKey.firstCall.args[0], 'first call with ALPHA');
        assertEqual('\uffff', collection.idToPrimaryKey.secondCall.args[0], 'second call with OMEGA');
    });

    it('calls datastore.queryKeys() with expected startKey, endKey, and includeDocuments set to true', () => {
        assertEqual(1, datastore.queryKeys.callCount, 'datastore.queryKeys() was called once');
        const queryParams = datastore.queryKeys.firstCall.args[0];
        assertEqual(true, queryParams.includeDocuments, 'includeDocuments is true');
        assertEqual('Product__\u0000', queryParams.startKey, 'startKey uses ALPHA (lowest)');
        assertEqual('Product__\uffff', queryParams.endKey, 'endKey uses OMEGA (highest)');
    });

    it('returns the result of Model.fromRecord() for each returned item', () => {
        assertEqual(2, Product.fromRecord.callCount, 'Product.fromRecord() was called twice');
        assertEqual(2, result.items.length, 'result has 2 items');
        assert(result.items[0] instanceof Product, 'first item is instance of Product');
        assertEqual('prod-100', result.items[0].id, 'first item has correct id');
        assert(result.items[1] instanceof Product, 'second item is instance of Product');
        assertEqual('prod-500', result.items[1].id, 'second item has correct id');
    });
});

describe('KixxBaseCollection#scanItems() using default startKey and endKey for descending scans', ({ before, after, it }) => {
    let context;
    let datastore;
    let collection;
    let result;
    let mockQueryResult;

    before(async () => {
        // Mock datastore result with items (in descending order)
        mockQueryResult = {
            items: [
                { document: { id: 'prod-900', name: 'Newest', price: 99.99 } },
                { document: { id: 'prod-100', name: 'Oldest', price: 5.99 } },
            ],
        };

        // Mock datastore with stubbed queryKeys method
        datastore = {
            queryKeys: sinon.stub().resolves(mockQueryResult),
        };

        // Mock context that provides the datastore service
        context = {
            getService: sinon.stub().returns(datastore),
        };

        // Create collection instance
        collection = new ProductCollection(context);

        // Spy on the methods we want to verify are called
        sinon.spy(collection, 'idToPrimaryKey');
        sinon.spy(Product, 'fromRecord');

        // Call the method under test with descending=true
        result = await collection.scanItems({ descending: true });
    });

    after(() => {
        sinon.restore();
    });

    it('calls idToPrimaryKey()', () => {
        // Should be called twice: once for default startKey (OMEGA), once for default endKey (ALPHA)
        assertEqual(2, collection.idToPrimaryKey.callCount, 'idToPrimaryKey() was called twice');
        assertEqual('\uffff', collection.idToPrimaryKey.firstCall.args[0], 'first call with OMEGA (highest)');
        assertEqual('\u0000', collection.idToPrimaryKey.secondCall.args[0], 'second call with ALPHA (lowest)');
    });

    it('calls datastore.queryKeys() with expected startKey, endKey, and includeDocuments set to true', () => {
        assertEqual(1, datastore.queryKeys.callCount, 'datastore.queryKeys() was called once');
        const queryParams = datastore.queryKeys.firstCall.args[0];
        assertEqual(true, queryParams.includeDocuments, 'includeDocuments is true');
        assertEqual(true, queryParams.descending, 'descending is true');
        assertEqual('Product__\uffff', queryParams.startKey, 'startKey uses OMEGA (highest)');
        assertEqual('Product__\u0000', queryParams.endKey, 'endKey uses ALPHA (lowest)');
    });

    it('returns the result of Model.fromRecord() for each returned item', () => {
        assertEqual(2, Product.fromRecord.callCount, 'Product.fromRecord() was called twice');
        assertEqual(2, result.items.length, 'result has 2 items');
        assert(result.items[0] instanceof Product, 'first item is instance of Product');
        assertEqual('prod-900', result.items[0].id, 'first item has correct id (newest)');
        assert(result.items[1] instanceof Product, 'second item is instance of Product');
        assertEqual('prod-100', result.items[1].id, 'second item has correct id (oldest)');
    });
});
