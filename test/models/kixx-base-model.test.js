import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import sinon from 'sinon';
import KixxBaseModel from '../../lib/models/kixx-base-model.js';

class Product extends KixxBaseModel { }

describe('KixxBaseModel constructor', ({ before, it }) => {
    let product;

    before(() => {
        product = new Product({ name: 'Widget', price: 9.99, type: 'ShouldBeOverridden' });
    });

    it('assigns given props', () => {
        assertEqual('Widget', product.name, 'name prop');
        assertEqual(9.99, product.price, 'price prop');
    });

    it('overrides the type prop', () => {
        assertEqual('Product', product.type, 'type prop');
    });
});

describe('KixxBaseModel#assignProps()', ({ before, it }) => {
    let product;

    before(() => {
        product = new Product({ name: 'Initial' });
        product.assignProps({ name: 'Updated', color: 'blue', type: 'ShouldBeOverridden' });
    });

    it('assigns given props', () => {
        assertEqual('Updated', product.name, 'name prop');
        assertEqual('blue', product.color, 'color prop');
    });

    it('overrides the type prop', () => {
        assertEqual('Product', product.type, 'type prop');
    });
});

describe('KixxBaseModel#toRecord()', ({ before, it }) => {
    let product;
    let record;

    before(() => {
        product = new Product({ id: 'prod-123', name: 'Widget', price: 9.99 });
        record = product.toRecord();
    });

    it('makes a copy of the model instance with only enumerable properties', () => {
        // Verify it's a different object (not the same reference)
        assertEqual(false, record === product, 'record is not the same reference as product');

        // Verify properties were copied
        assertEqual('prod-123', record.id, 'id prop');
        assertEqual('Widget', record.name, 'name prop');
        assertEqual(9.99, record.price, 'price prop');
        assertEqual('Product', record.type, 'type prop');

        // Verify it's a true copy - modifying record doesn't affect product
        record.name = 'Modified';
        assertEqual('Widget', product.name, 'product.name unchanged after modifying record');
    });
});

describe('KixxBaseModel.fromRecord()', ({ before, it }) => {
    let product;
    let record;

    before(() => {
        record = { id: 'prod-456', name: 'Gadget', price: 19.99, type: 'Record' };
        product = Product.fromRecord(record);
    });

    it('creates a new instance of the model subclass', () => {
        assertEqual(true, product instanceof Product, 'product is instance of Product');
        assertEqual(true, product instanceof KixxBaseModel, 'product is instance of KixxBaseModel');
    });

    it('assigns the props from the given record', () => {
        assertEqual('prod-456', product.id, 'id prop');
        assertEqual('Gadget', product.name, 'name prop');
        assertEqual(19.99, product.price, 'price prop');
        assertEqual('Product', product.type, 'type prop overridden to Product');
    });
});

describe('KixxBaseModel.create()', ({ before, after, it }) => {
    let product;

    before(() => {
        sinon.stub(Product, 'genId').returns('generated-uuid-123');
        product = Product.create({ name: 'Gadget', price: 29.99 });
    });

    after(() => {
        sinon.restore();
    });

    it('creates a new instance of the model subclass', () => {
        assertEqual(true, product instanceof Product, 'product is instance of Product');
        assertEqual(true, product instanceof KixxBaseModel, 'product is instance of KixxBaseModel');
    });

    it('assigns the given props', () => {
        assertEqual('Gadget', product.name, 'name prop');
        assertEqual(29.99, product.price, 'price prop');
        assertEqual('Product', product.type, 'type prop');
    });

    it('calls .genId() and assigns it as the id prop', () => {
        assertEqual(1, Product.genId.callCount, 'genId() was called once');
        assertEqual('generated-uuid-123', product.id, 'id prop from genId()');
    });
});

describe('KixxBaseModel.create() when an id is provided', ({ before, after, it }) => {
    let product;

    before(() => {
        sinon.stub(Product, 'genId').returns('should-not-be-used');
        product = Product.create({ id: 'custom-id-789', name: 'Widget', price: 39.99 });
    });

    after(() => {
        sinon.restore();
    });

    it('creates a new instance of the model subclass', () => {
        assertEqual(true, product instanceof Product, 'product is instance of Product');
        assertEqual(true, product instanceof KixxBaseModel, 'product is instance of KixxBaseModel');
    });

    it('assigns the given props', () => {
        assertEqual('Widget', product.name, 'name prop');
        assertEqual(39.99, product.price, 'price prop');
        assertEqual('Product', product.type, 'type prop');
    });

    it('allows the id prop to be overridden and does not call .genId()', () => {
        assertEqual(0, Product.genId.callCount, 'genId() was not called');
        assertEqual('custom-id-789', product.id, 'id prop from provided value');
    });
});
