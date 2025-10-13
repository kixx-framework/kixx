import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
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
