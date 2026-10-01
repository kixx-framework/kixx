import {
    assert,
    assertFunction,
    assertNonEmptyString,
    isBoolean,
    isFunction,
    isNonEmptyString,
    isPlainObject,
    isUndefined,
} from '../../kixx/assertions/mod.js';
import deepFreeze from '../../kixx/utils/deep-freeze.js';
import { evaluatePermissions } from '../../kixx/permissions/permission-validation.js';
import {
    ADMIN_DATA_ACTIONS,
    adminDataActionUrn,
    adminDataCollectionResource,
    isAdminDataCollectionName,
} from '../permissions/admin-data-api.js';


/**
 * Page size used by list requests that omit `page[size]`.
 * @type {number}
 */
export const DEFAULT_PAGE_SIZE = 25;

/**
 * Largest `page[size]` a list request may ask for.
 * @type {number}
 */
export const MAX_PAGE_SIZE = 100;

// JSON:API resource types are public URL segments, so keep them lowercase and
// hyphenated, e.g. `files` or `release-notes`.
const RESOURCE_TYPE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ATTRIBUTE_NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/;
const SORT_NAME_PATTERN = /^-?[a-z][A-Za-z0-9]*$/;

// Storage identity, concurrency, and JSON:API structural members are owned by
// the server and the protocol. Exposing one as an attribute would let a
// client-supplied value shadow the real member or be written by a blind merge.
const RESERVED_ATTRIBUTE_NAMES = new Set([
    'id',
    'type',
    'version',
    'sortKey',
    'createdAt',
    'updatedAt',
    'meta',
    'links',
    'relationships',
]);

const REGISTRATION_KEYS = new Set([ 'type', 'collection', 'description', 'attributes', 'operations' ]);
const ATTRIBUTE_KEYS = new Set([ 'description', 'schema' ]);
const OPERATION_KEYS = {
    list: new Set([ 'sorts' ]),
    get: new Set([]),
    create: new Set([ 'attributes', 'required', 'persist' ]),
    update: new Set([ 'attributes' ]),
    delete: new Set([]),
};
const SORT_KEYS = new Set([ 'name', 'description', 'index', 'descending' ]);

// The Collection method each operation relies on. Checked at boot so a
// registration cannot enable an operation its gateway cannot perform.
const REQUIRED_COLLECTION_METHODS = {
    list: [ 'scan' ],
    get: [ 'get' ],
    create: [ 'create' ],
    update: [ 'get', 'update' ],
    delete: [ 'get', 'deleteStrict' ],
};


/**
 * Explicit catalog of Collections exposed through the Administrative Data API.
 *
 * Nothing is exposed by default: a Collection is reachable only when it has a
 * registration, and only through the operations that registration declares.
 * Write operations (`create`, `update`, `delete`) are enabled one by one and
 * name the attributes a client may supply. Every registration is validated
 * and frozen when the registry is built, so a malformed one fails the import
 * as a programmer error instead of surfacing on a request.
 *
 * Authorization is always the intersection of the current registration and a
 * principal's grants: a grant for a retired Collection or a disabled operation
 * confers nothing.
 */
export default class ResourceRegistry {

    #resourcesByType = new Map();
    #resourcesByCollection = new Map();

    /**
     * @param {Object[]} registrations - Resource registrations; see docs/admin-data-api.md.
     * @throws {AssertionError} When a registration is malformed or duplicates a type or Collection.
     */
    constructor(registrations) {
        assert(Array.isArray(registrations), 'ResourceRegistry: registrations must be an array');

        for (const registration of registrations) {
            const resource = normalizeRegistration(registration);

            assert(
                !this.#resourcesByType.has(resource.type),
                `ResourceRegistry: duplicate resource type '${ resource.type }'`,
            );
            assert(
                !this.#resourcesByCollection.has(resource.collection),
                `ResourceRegistry: Collection '${ resource.collection }' is registered more than once`,
            );

            this.#resourcesByType.set(resource.type, resource);
            this.#resourcesByCollection.set(resource.collection, resource);
        }
    }

    /**
     * Looks up a registration by its public JSON:API resource type.
     * @param {string} type - JSON:API resource type, such as `files`.
     * @returns {Object|null} Frozen registration, or null when the type is not exposed.
     */
    getResource(type) {
        return this.#resourcesByType.get(type) ?? null;
    }

    /**
     * Looks up a registration by its Collection name.
     * @param {string} collection - Registered Collection name, such as `File`.
     * @returns {Object|null} Frozen registration, or null when the Collection is not exposed.
     */
    getResourceByCollection(collection) {
        return this.#resourcesByCollection.get(collection) ?? null;
    }

    /**
     * Lists every registration in registration order.
     * @returns {Object[]} Fresh array of frozen registrations.
     */
    listResources() {
        return Array.from(this.#resourcesByType.values());
    }

    /**
     * Reports whether a registration enables an operation, independent of any principal.
     * @param {string} type - JSON:API resource type.
     * @param {string} action - One of ADMIN_DATA_ACTIONS.
     * @returns {boolean} True when the type is registered and declares the operation.
     */
    isOperationEnabled(type, action) {
        const resource = this.getResource(type);
        return Boolean(resource) && Object.hasOwn(resource.operations, action);
    }

    /**
     * Decides whether permissions allow an action on a resource type. The
     * operation must be enabled by the current registration and granted to
     * the principal on that exact Collection.
     * @param {Object[]} permissions - Evaluator grants carried by the principal.
     * @param {string} type - JSON:API resource type.
     * @param {string} action - One of ADMIN_DATA_ACTIONS.
     * @returns {boolean} True only when both the registration and a grant allow it.
     */
    isAuthorized(permissions, type, action) {
        if (!this.isOperationEnabled(type, action)) {
            return false;
        }

        const resource = this.getResource(type);

        return evaluatePermissions(permissions, {
            action: adminDataActionUrn(action),
            resource: adminDataCollectionResource(resource.collection),
        });
    }

    /**
     * Lists the actions permissions allow on a resource type.
     * @param {Object[]} permissions - Evaluator grants carried by the principal.
     * @param {string} type - JSON:API resource type.
     * @returns {string[]} Authorized actions in ADMIN_DATA_ACTIONS order.
     */
    listAuthorizedActions(permissions, type) {
        return ADMIN_DATA_ACTIONS.filter((action) => this.isAuthorized(permissions, type, action));
    }

    /**
     * Describes the resources, fields, and query capabilities a principal can
     * use. Resources without an authorized action are omitted, and only the
     * contracts for authorized actions are included. Discovery is advisory:
     * every request is still authorized on its own.
     * @param {Object[]} permissions - Evaluator grants carried by the principal.
     * @returns {Object[]} Fresh plain descriptors, one per accessible resource.
     */
    describeAccessibleResources(permissions) {
        const descriptors = [];

        for (const resource of this.#resourcesByType.values()) {
            const actions = this.listAuthorizedActions(permissions, resource.type);

            if (actions.length > 0) {
                descriptors.push(describeResource(resource, actions));
            }
        }

        return descriptors;
    }

    /**
     * Verifies every registration against the application's registered
     * Collections. Call from app initialization so a registration naming a
     * missing Collection, attribute, method, or index fails boot.
     * @param {Object} context - Application context exposing getCollection().
     * @returns {void}
     * @throws {AssertionError} When a registration does not match its Collection.
     */
    assertCollections(context) {
        for (const resource of this.#resourcesByType.values()) {
            const collection = context.getCollection(resource.collection);
            const label = `Admin data resource '${ resource.type }'`;

            for (const action of Object.keys(resource.operations)) {
                for (const method of REQUIRED_COLLECTION_METHODS[action]) {
                    assert(
                        isFunction(collection[method]),
                        `${ label } enables '${ action }' but Collection '${ resource.collection }' has no ${ method }() method`,
                    );
                }
            }

            const properties = collection.Record?.schema?.properties;
            if (isPlainObject(properties)) {
                for (const name of Object.keys(resource.attributes)) {
                    assert(
                        Object.hasOwn(properties, name),
                        `${ label } attribute '${ name }' is not in the ${ resource.collection } Record schema`,
                    );
                }
            }

            const indexNames = new Set((collection.constructor.INDEXES ?? []).map((index) => index.name));
            for (const sort of resource.operations.list?.sorts ?? []) {
                if (sort.index) {
                    assert(
                        indexNames.has(sort.index),
                        `${ label } sort '${ sort.name }' names unknown index '${ sort.index }'`,
                    );
                }
            }
        }
    }
}


function normalizeRegistration(registration) {
    assert(isPlainObject(registration), 'ResourceRegistry: each registration must be a plain object');

    const label = `Admin data resource '${ registration.type }'`;
    assertKnownKeys(registration, REGISTRATION_KEYS, label);

    assert(
        isNonEmptyString(registration.type) && RESOURCE_TYPE_PATTERN.test(registration.type),
        `${ label }: type must be a lowercase hyphenated name`,
    );
    assert(
        isAdminDataCollectionName(registration.collection),
        `${ label }: collection must be a PascalCase Collection name`,
    );
    assertNonEmptyString(registration.description, `${ label }: description`);

    const attributes = normalizeAttributes(registration.attributes, label);
    const operations = normalizeOperations(registration.operations, attributes, label);

    // deepFreeze leaves functions alone, so a create persist hook stays callable.
    return deepFreeze({
        type: registration.type,
        collection: registration.collection,
        description: registration.description,
        attributes,
        operations,
    });
}

function normalizeAttributes(attributes, label) {
    assert(
        isPlainObject(attributes) && Object.keys(attributes).length > 0,
        `${ label }: attributes must be a non-empty object`,
    );

    const normalized = {};

    for (const [ name, attribute ] of Object.entries(attributes)) {
        assert(ATTRIBUTE_NAME_PATTERN.test(name), `${ label }: attribute '${ name }' must be camelCase`);
        assert(!RESERVED_ATTRIBUTE_NAMES.has(name), `${ label }: attribute '${ name }' is server-owned`);
        assert(isPlainObject(attribute), `${ label }: attribute '${ name }' must be a plain object`);
        assertKnownKeys(attribute, ATTRIBUTE_KEYS, `${ label } attribute '${ name }'`);
        assertNonEmptyString(attribute.description, `${ label }: attribute '${ name }' description`);
        assert(isPlainObject(attribute.schema), `${ label }: attribute '${ name }' schema must be a plain object`);

        // Clone so freezing never reaches a schema shared with a Record class.
        normalized[name] = {
            description: attribute.description,
            schema: structuredClone(attribute.schema),
        };
    }

    return normalized;
}

function normalizeOperations(operations, attributes, label) {
    assert(isPlainObject(operations), `${ label }: operations must be a plain object`);

    const normalized = {};

    for (const [ action, operation ] of Object.entries(operations)) {
        assert(Object.hasOwn(OPERATION_KEYS, action), `${ label }: unknown operation '${ action }'`);

        // An operation is enabled by being present; `false` or `null` would
        // read as "disabled" yet still be present, so only objects are allowed.
        assert(isPlainObject(operation), `${ label }: operation '${ action }' must be a plain object`);
        assertKnownKeys(operation, OPERATION_KEYS[action], `${ label } operation '${ action }'`);
    }

    assert(Object.keys(operations).length > 0, `${ label }: at least one operation must be enabled`);

    if (operations.list) {
        normalized.list = { sorts: normalizeSorts(operations.list.sorts, label) };
    }

    if (operations.get) {
        normalized.get = {};
    }

    if (operations.create) {
        const { persist } = operations.create;
        const writable = normalizeWritableAttributes(operations.create.attributes, attributes, `${ label } create`);
        const required = normalizeWritableAttributes(operations.create.required ?? [], attributes, `${ label } create required`, true);

        for (const name of required) {
            assert(writable.includes(name), `${ label }: required create attribute '${ name }' is not writable`);
        }

        normalized.create = { attributes: writable, required };

        if (!isUndefined(persist)) {
            assertFunction(persist, `${ label }: create persist`);
            normalized.create.persist = persist;
        }
    }

    if (operations.update) {
        normalized.update = {
            attributes: normalizeWritableAttributes(operations.update.attributes, attributes, `${ label } update`),
        };
    }

    if (operations.delete) {
        normalized.delete = {};
    }

    return normalized;
}

function normalizeWritableAttributes(names, attributes, label, allowEmpty) {
    assert(Array.isArray(names), `${ label }: attributes must be an array`);
    assert(allowEmpty || names.length > 0, `${ label }: attributes must not be empty`);

    const seen = new Set();

    for (const name of names) {
        assert(Object.hasOwn(attributes, name), `${ label }: '${ name }' is not a declared attribute`);
        assert(!seen.has(name), `${ label }: '${ name }' is listed more than once`);
        seen.add(name);
    }

    return names.slice();
}

function normalizeSorts(sorts, label) {
    assert(Array.isArray(sorts) && sorts.length > 0, `${ label }: list sorts must be a non-empty array`);

    const names = new Set();

    return sorts.map((sort) => {
        assert(isPlainObject(sort), `${ label }: each list sort must be a plain object`);
        assertKnownKeys(sort, SORT_KEYS, `${ label } list sort`);
        assert(
            isNonEmptyString(sort.name) && SORT_NAME_PATTERN.test(sort.name),
            `${ label }: list sort name must be a JSON:API sort field such as '-createdAt'`,
        );
        assert(!names.has(sort.name), `${ label }: list sort '${ sort.name }' is declared more than once`);
        names.add(sort.name);
        assertNonEmptyString(sort.description, `${ label }: list sort '${ sort.name }' description`);
        assert(
            isUndefined(sort.index) || isNonEmptyString(sort.index),
            `${ label }: list sort '${ sort.name }' index must be a non-empty string`,
        );
        assert(
            isBoolean(sort.descending),
            `${ label }: list sort '${ sort.name }' descending must be a boolean`,
        );

        const normalized = { name: sort.name, description: sort.description, descending: sort.descending };
        if (sort.index) {
            normalized.index = sort.index;
        }
        return normalized;
    });
}

function assertKnownKeys(object, allowedKeys, label) {
    for (const key of Object.keys(object)) {
        assert(allowedKeys.has(key), `${ label }: unknown key '${ key }'`);
    }
}

function describeResource(resource, actions) {
    const descriptor = {
        type: resource.type,
        collection: resource.collection,
        description: resource.description,
        actions,
        attributes: structuredClone(resource.attributes),
    };

    if (actions.includes('list')) {
        descriptor.list = {
            sort: resource.operations.list.sorts.map((sort) => ({ name: sort.name, description: sort.description })),
            defaultSort: resource.operations.list.sorts[0].name,
            page: { defaultSize: DEFAULT_PAGE_SIZE, maxSize: MAX_PAGE_SIZE },
        };
    }

    if (actions.includes('create')) {
        descriptor.create = {
            attributes: resource.operations.create.attributes.slice(),
            required: resource.operations.create.required.slice(),
        };
    }

    if (actions.includes('update')) {
        descriptor.update = { attributes: resource.operations.update.attributes.slice() };
    }

    return descriptor;
}
