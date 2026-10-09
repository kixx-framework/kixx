import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import ResourceRegistry, {
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
} from '../../../../src/app/admin-data-api/resource-registry.js';
import { adminDataResources } from '../../../../src/app/admin-data-api/mod.js';
import { toAdminDataPermissions } from '../../../../src/app/permissions/admin-data-api.js';
import { deriveRolePermissions, ROLE_ROOT_ADMIN } from '../../../../src/app/permissions/roles.js';
import FileCollection from '../../../../src/app/collections/file-collection.js';


function makeRegistration(overrides) {
    return Object.assign({
        type: 'widgets',
        collection: 'Widget',
        description: 'Test widgets.',
        attributes: {
            name: { description: 'Widget name.', schema: { type: 'string' } },
            color: { description: 'Widget color.', schema: { type: 'string' } },
        },
        operations: {
            list: { sorts: [ { name: '-createdAt', description: 'Newest first.', descending: true } ] },
            get: {},
        },
    }, overrides);
}

function makeWritableRegistration() {
    return makeRegistration({
        operations: {
            list: { sorts: [ { name: 'name', description: 'By name.', descending: false } ] },
            get: {},
            create: { attributes: [ 'name', 'color' ], required: [ 'name' ] },
            update: { attributes: [ 'color' ] },
            delete: {},
        },
    });
}

function makeWidgetCollection(overrides) {
    class WidgetRecord {
        static schema = { properties: { name: {}, color: {} } };
    }

    class WidgetCollection {
        static INDEXES = [];
        Record = WidgetRecord;
        scan() {}
        get() {}
        create() {}
        update() {}
        deleteStrict() {}
    }

    return Object.assign(new WidgetCollection(), overrides);
}

function makeContext(collections) {
    return {
        getCollection(name) {
            assert(Object.hasOwn(collections, name), `unexpected collection ${ name }`);
            return collections[name];
        },
    };
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

function assertInvalid(registration, pattern) {
    const error = catchError(() => new ResourceRegistry([ registration ]));
    assert(error, 'expected registration to be rejected');
    assertEqual('AssertionError', error.name);
    assertMatches(pattern, error.message);
}


describe('app/admin-data-api/resource-registry', ({ describe }) => {

    describe('registration validation', ({ it }) => {
        it('accepts a valid registration and freezes it', () => {
            const registry = new ResourceRegistry([ makeWritableRegistration() ]);
            const resource = registry.getResource('widgets');

            assertEqual('Widget', resource.collection);
            assert(Object.isFrozen(resource));
            assert(Object.isFrozen(resource.operations.create.attributes));
            assert(Object.isFrozen(resource.attributes.name.schema));
        });

        it('does not freeze schemas shared with the caller', () => {
            const schema = { type: 'string' };
            const registration = makeRegistration();
            registration.attributes.name.schema = schema;

            new ResourceRegistry([ registration ]);

            assertEqual(false, Object.isFrozen(schema));
        });

        it('rejects duplicate resource types', () => {
            const error = catchError(() => new ResourceRegistry([
                makeRegistration(),
                makeRegistration({ collection: 'OtherWidget' }),
            ]));
            assertMatches("duplicate resource type 'widgets'", error.message);
        });

        it('rejects a Collection registered under two types', () => {
            const error = catchError(() => new ResourceRegistry([
                makeRegistration(),
                makeRegistration({ type: 'gadgets' }),
            ]));
            assertMatches("Collection 'Widget' is registered more than once", error.message);
        });

        it('rejects malformed identity and description', () => {
            assertInvalid(makeRegistration({ type: 'Widgets' }), 'type must be');
            assertInvalid(makeRegistration({ collection: '*' }), 'collection must be');
            assertInvalid(makeRegistration({ description: '' }), 'description');
            assertInvalid(makeRegistration({ extra: true }), "unknown key 'extra'");
        });

        it('rejects server-owned and malformed attribute names', () => {
            for (const name of [ 'id', 'type', 'version', 'sortKey', 'createdAt', 'updatedAt', 'meta' ]) {
                assertInvalid(makeRegistration({
                    attributes: { [name]: { description: 'x', schema: {} } },
                }), 'server-owned');
            }
            assertInvalid(makeRegistration({
                attributes: { 'Bad-Name': { description: 'x', schema: {} } },
            }), 'must be camelCase');
            assertInvalid(makeRegistration({ attributes: {} }), 'non-empty object');
        });

        it('rejects attributes without a description or schema', () => {
            assertInvalid(makeRegistration({ attributes: { name: { schema: {} } } }), 'description');
            assertInvalid(makeRegistration({ attributes: { name: { description: 'x' } } }), 'schema');
        });

        it('rejects unknown, disabled-looking, and empty operation sets', () => {
            assertInvalid(makeRegistration({ operations: { patch: {} } }), "unknown operation 'patch'");
            assertInvalid(makeRegistration({ operations: { delete: false } }), 'must be a plain object');
            assertInvalid(makeRegistration({ operations: {} }), 'at least one operation');
            assertInvalid(makeRegistration({ operations: { get: { fields: [] } } }), "unknown key 'fields'");
        });

        it('rejects write attributes that are not declared or are duplicated', () => {
            assertInvalid(makeRegistration({
                operations: { create: { attributes: [ 'name', 'size' ] } },
            }), "'size' is not a declared attribute");
            assertInvalid(makeRegistration({
                operations: { update: { attributes: [ 'name', 'name' ] } },
            }), 'listed more than once');
            assertInvalid(makeRegistration({
                operations: { update: { attributes: [] } },
            }), 'must not be empty');
            assertInvalid(makeRegistration({
                operations: { create: { attributes: [ 'name' ], required: [ 'color' ] } },
            }), "required create attribute 'color' is not writable");
            assertInvalid(makeRegistration({
                operations: { create: { attributes: [ 'name' ], persist: 'nope' } },
            }), 'persist');
        });

        it('rejects malformed list sorts', () => {
            assertInvalid(makeRegistration({ operations: { list: { sorts: [] } } }), 'non-empty array');
            assertInvalid(makeRegistration({
                operations: { list: { sorts: [ { name: 'bad name', description: 'x', descending: true } ] } },
            }), 'JSON:API sort field');
            assertInvalid(makeRegistration({
                operations: { list: { sorts: [ { name: 'name', description: 'x' } ] } },
            }), 'descending must be a boolean');
            assertInvalid(makeRegistration({
                operations: {
                    list: {
                        sorts: [
                            { name: 'name', description: 'x', descending: false },
                            { name: 'name', description: 'y', descending: true },
                        ],
                    },
                },
            }), 'declared more than once');
        });
    });

    describe('lookup', ({ it }) => {
        it('returns null for unregistered types and Collections', () => {
            const registry = new ResourceRegistry([ makeRegistration() ]);

            assertEqual(null, registry.getResource('gadgets'));
            assertEqual(null, registry.getResourceByCollection('Gadget'));
            assertEqual('widgets', registry.getResourceByCollection('Widget').type);
            assertEqual(1, registry.listResources().length);
        });

        it('reports only declared operations as enabled', () => {
            const registry = new ResourceRegistry([ makeRegistration() ]);

            assertEqual(true, registry.isOperationEnabled('widgets', 'list'));
            assertEqual(true, registry.isOperationEnabled('widgets', 'get'));
            assertEqual(false, registry.isOperationEnabled('widgets', 'create'));
            assertEqual(false, registry.isOperationEnabled('widgets', 'delete'));
            assertEqual(false, registry.isOperationEnabled('gadgets', 'get'));
            assertEqual(false, registry.isOperationEnabled('widgets', 'hasOwnProperty'));
        });
    });

    describe('authorization', ({ it }) => {
        it('requires both an enabled operation and a matching grant', () => {
            const registry = new ResourceRegistry([ makeRegistration() ]);
            const permissions = toAdminDataPermissions([
                { collection: 'Widget', actions: [ 'get', 'update' ] },
            ]);

            assertEqual(true, registry.isAuthorized(permissions, 'widgets', 'get'));
            // Granted on the token but not enabled by the registration.
            assertEqual(false, registry.isAuthorized(permissions, 'widgets', 'update'));
            // Enabled by the registration but not granted.
            assertEqual(false, registry.isAuthorized(permissions, 'widgets', 'list'));
            assertEqual([ 'get' ].join(), registry.listAuthorizedActions(permissions, 'widgets').join());
        });

        it('confers nothing for grants on an unregistered Collection', () => {
            const registry = new ResourceRegistry([ makeRegistration() ]);
            const permissions = toAdminDataPermissions([
                { collection: 'Retired', actions: [ 'get' ] },
            ]);

            assertEqual(0, registry.describeAccessibleResources(permissions).length);
            assertEqual(false, registry.isAuthorized(permissions, 'retired', 'get'));
        });

        it('never lets a wildcard permission exceed the registration', () => {
            const registry = new ResourceRegistry([ makeRegistration() ]);
            const permissions = deriveRolePermissions([ ROLE_ROOT_ADMIN ]);

            assertEqual([ 'list', 'get' ].join(), registry.listAuthorizedActions(permissions, 'widgets').join());
        });
    });

    describe('describeAccessibleResources()', ({ it }) => {
        it('includes only authorized operation contracts', () => {
            const registry = new ResourceRegistry([ makeWritableRegistration() ]);
            const permissions = toAdminDataPermissions([
                { collection: 'Widget', actions: [ 'get', 'update' ] },
            ]);

            const [ descriptor ] = registry.describeAccessibleResources(permissions);

            assertEqual('widgets', descriptor.type);
            assertEqual([ 'get', 'update' ].join(), descriptor.actions.join());
            assertEqual([ 'color' ].join(), descriptor.update.attributes.join());
            assertEqual(undefined, descriptor.list);
            assertEqual(undefined, descriptor.create);
            assertEqual('string', descriptor.attributes.name.schema.type);
        });

        it('describes list sorting and page limits', () => {
            const registry = new ResourceRegistry([ makeWritableRegistration() ]);
            const permissions = toAdminDataPermissions([
                { collection: 'Widget', actions: [ 'list', 'create' ] },
            ]);

            const [ descriptor ] = registry.describeAccessibleResources(permissions);

            assertEqual('name', descriptor.list.defaultSort);
            assertEqual(DEFAULT_PAGE_SIZE, descriptor.list.page.defaultSize);
            assertEqual(MAX_PAGE_SIZE, descriptor.list.page.maxSize);
            assertEqual([ 'name' ].join(), descriptor.create.required.join());
        });

        it('returns fresh descriptors that cannot mutate the registry', () => {
            const registry = new ResourceRegistry([ makeWritableRegistration() ]);
            const permissions = toAdminDataPermissions([ { collection: 'Widget', actions: [ 'get' ] } ]);

            const [ descriptor ] = registry.describeAccessibleResources(permissions);
            descriptor.attributes.name.schema.type = 'number';

            assertEqual('string', registry.getResource('widgets').attributes.name.schema.type);
        });
    });

    describe('assertCollections()', ({ it }) => {
        it('accepts a registration matching its Collection', () => {
            const registry = new ResourceRegistry([ makeWritableRegistration() ]);
            registry.assertCollections(makeContext({ Widget: makeWidgetCollection() }));
        });

        it('rejects an unregistered Collection', () => {
            const registry = new ResourceRegistry([ makeRegistration() ]);
            const error = catchError(() => registry.assertCollections(makeContext({})));
            assertMatches('unexpected collection Widget', error.message);
        });

        it('rejects an attribute missing from the Record schema', () => {
            const registry = new ResourceRegistry([ makeRegistration({
                attributes: { size: { description: 'x', schema: {} } },
            }) ]);
            const error = catchError(() => {
                registry.assertCollections(makeContext({ Widget: makeWidgetCollection() }));
            });
            assertMatches("attribute 'size' is not in the Widget Record schema", error.message);
        });

        it('rejects an enabled operation the Collection cannot perform', () => {
            const registry = new ResourceRegistry([ makeWritableRegistration() ]);
            const error = catchError(() => {
                registry.assertCollections(makeContext({ Widget: makeWidgetCollection({ deleteStrict: null }) }));
            });
            assertMatches("enables 'delete'", error.message);
        });

        it('rejects a sort naming an unknown index', () => {
            const registry = new ResourceRegistry([ makeRegistration({
                operations: {
                    list: { sorts: [ { name: 'color', description: 'x', index: 'widget_color', descending: false } ] },
                },
            }) ]);
            const error = catchError(() => {
                registry.assertCollections(makeContext({ Widget: makeWidgetCollection() }));
            });
            assertMatches("unknown index 'widget_color'", error.message);
        });
    });

    describe('application registrations', ({ it }) => {
        it('match the registered File Collection', () => {
            const files = new FileCollection({ db: {} });
            adminDataResources.assertCollections(makeContext({ File: files }));
        });

        it('expose File with record-only CRUD and server-owned upload time', () => {
            const resource = adminDataResources.getResource('files');

            assertEqual('File', resource.collection);
            assertEqual([ 'list', 'get', 'create', 'update', 'delete' ].join(), Object.keys(resource.operations).join());
            assertEqual(false, resource.operations.create.attributes.includes('originalUploadedAt'));
            assertEqual(false, resource.operations.update.attributes.includes('originalUploadedAt'));
            assertEqual('-originalUploadedAt', resource.operations.list.sorts[0].name);
        });

        it('does not expose FileContent or any other Collection', () => {
            assertEqual(1, adminDataResources.listResources().length);
            assertEqual(null, adminDataResources.getResourceByCollection('FileContent'));
        });
    });
});
