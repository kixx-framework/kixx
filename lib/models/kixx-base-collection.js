/**
 * @fileoverview Base collection class for managing datastore operations
 *
 * Provides CRUD operations and scanning capabilities for Model instances
 * stored in a Kixx datastore. Subclasses override the static Model property
 * to specify which Model type the collection manages.
 */

import KixxBaseModel from './kixx-base-model.js';
import { NotFoundError } from '../errors/mod.js';

import {
    isBoolean,
    assert,
    assertEqual,
    assertArray,
    assertFunction,
    assertNonEmptyString
} from '../assertions/mod.js';

import { ALPHA, OMEGA } from '../lib/constants.js';


/**
 * Base collection class for managing typed Model instances in a datastore
 *
 * @class
 */
export default class KixxBaseCollection {

    // Subclasses override this to specify which Model type the collection manages.
    // Example: static Model = UserModel;
    static Model = KixxBaseModel;

    /**
     * Creates a new collection instance
     *
     * @param {Object} context - Application context providing access to services
     * @throws {Error} When context is missing or Model is invalid
     */
    constructor(context) {
        const Model = this.constructor.Model;

        assert(context, 'A Collection requires a Context');
        assertFunction(Model, `Invalid .Model for Collection "${ this.constructor.name }"`);
        assertNonEmptyString(Model.name, `Invalid .Model.name for Collection "${ this.constructor.name }"`);

        // Define properties with specific enumerability to control exposure
        // to JSON serialization output.
        Object.defineProperties(this, {
            Model: {
                enumerable: true,
                value: Model,
            },
            type: {
                enumerable: true,
                value: Model.name,
            },
            context: {
                value: context,
            },
        });
    }

    /**
     * Returns the datastore instance for this collection
     *
     * @returns {Object} The datastore service instance
     */
    // Override get datastore() to choose a different datastore.
    get datastore() {
        return this.context.getService('kixx.Datastore');
    }

    /**
     * Retrieves a single item by ID from the datastore
     *
     * @async
     * @param {string} id - The item identifier
     * @param {Object} [options] - Optional datastore query options
     * @returns {Promise<Object|null>} The Model instance or null if not found
     * @throws {Error} When id is not a non-empty string
     */
    async getItem(id, options) {
        assertNonEmptyString(id, `Invalid id passed to ${ this.constructor.name }#getItem()`);

        const key = this.idToPrimaryKey(id);
        const item = await this.datastore.getItem(key, options);

        if (item) {
            const { Model } = this;
            // Hydrate raw datastore record into Model instance
            return Model.fromRecord(item);
        }

        return null;
    }

    /**
     * Persists an item to the datastore
     *
     * @async
     * @param {Object} item - Model instance with id and toRecord() method
     * @param {Object} [options] - Optional datastore write options
     * @returns {Promise<Object>} The same item that was saved
     * @throws {Error} When item.id is missing or item lacks toRecord() method
     */
    async setItem(item, options) {
        assertNonEmptyString(item.id, `Invalid item.id passed to ${ this.constructor.name }#setItem()`);
        assertFunction(item.toRecord, `An item must have a #toRecord() method when passed to ${ this.constructor.name }#setItem()`);

        const key = this.idToPrimaryKey(item.id);
        await this.datastore.setItem(key, item.toRecord(), options);

        return item;
    }

    /**
     * Persists multiple items to the datastore in parallel
     *
     * @async
     * @param {Object[]} items - Array of Model instances to save
     * @param {Object} [options] - Optional datastore write options
     * @returns {Promise<Object[]>} The same items array that was saved
     * @throws {Error} When items is not an array or any item is invalid
     */
    async batchSetItems(items, options) {
        assertArray(items, `Invalid items array passed to ${ this.constructor.name }#batchSetItems()`);

        const promises = items.map((item) => {
            return this.setItem(item, options);
        });

        // Use Promise.all to write all items in parallel.
        await Promise.all(promises);

        return items;
    }

    /**
     * Updates an existing item using a transformation function
     *
     * @async
     * @param {string} id - The item identifier
     * @param {Function} updateFunction - Async function that receives and returns Model instance
     * @param {Object} [options] - Optional datastore update options
     * @returns {Promise<Object>} The updated Model instance
     * @throws {NotFoundError} When item does not exist
     * @throws {Error} When id is invalid or updateFunction returns invalid data
     *
     * @example
     * const updated = await collection.updateItem('123', async (user) => {
     *   user.lastLogin = new Date();
     *   return user;
     * });
     */
    async updateItem(id, updateFunction, options) {
        assertNonEmptyString(id, `Invalid item id passed to ${ this.constructor.name }#updateItem()`);

        const key = this.idToPrimaryKey(id);
        const { Model, type } = this;

        // Adapter function that bridges datastore's record format with
        // Model instances in the update function. This allows callers
        // to work with Model instances while the datastore
        // works with records
        const updateHandler = async (item) => {
            if (item) {
                // Hydrate record to Model, apply updates, then
                // dehydrate back to record.
                const modelInstance = await updateFunction(Model.fromRecord(item));
                assertEqual(item.id, modelInstance.id, `Invalid item.id returned from ${ this.constructor.name }#updateItem() update function`);
                assertFunction(modelInstance.toRecord, `An item must have a #toRecord() method when returned from ${ this.constructor.name }#updateItem() update function`);
                return modelInstance.toRecord();
            }
            throw new NotFoundError(`Item type:${ type } id: ${ id } does not exist for update`);
        };

        const doc = await this.datastore.updateItem(key, updateHandler, options);

        return Model.fromRecord(doc);
    }

    /**
     * Removes an item from the datastore by ID
     *
     * @async
     * @param {string} id - The item identifier
     * @returns {Promise<string>} The id of the deleted item
     * @throws {Error} When id is not a non-empty string
     */
    async deleteItem(id) {
        assertNonEmptyString(id, `Invalid item id passed to ${ this.constructor.name }#deleteItem()`);

        const key = this.idToPrimaryKey(id);
        await this.datastore.deleteItem(key);

        return id;
    }

    /**
     * Scans and retrieves items from the datastore with range and ordering options
     *
     * @async
     * @param {Object} [options={}] - Query options
     * @param {string} [options.startKey] - Starting item ID for range query
     * @param {string} [options.endKey] - Ending item ID for range query
     * @param {boolean} [options.descending=false] - Sort order (true for descending)
     * @param {number} [options.limit] - Maximum number of items to return
     * @returns {Promise<Object>} Result object with items array and query metadata
     * @returns {Object[]} result.items - Array of Model instances
     *
     * @example
     * // Get all items in ascending order
     * const result = await collection.scanItems();
     *
     * @example
     * // Get items in descending order with limit
     * const result = await collection.scanItems({
     *   descending: true,
     *   limit: 10
     * });
     */
    async scanItems(options) {
        const queryParams = {
            includeDocuments: true,
        };

        Object.assign(queryParams, options);

        const descending = isBoolean(queryParams.descending) ? queryParams.descending : false;

        if (options.startKey) {
            queryParams.startKey = this.idToPrimaryKey(options.startKey);
        } else {
            // For descending scans, start from the highest possible key.
            const suffix = descending ? OMEGA : ALPHA;
            queryParams.startKey = this.idToPrimaryKey(suffix);
        }
        if (options.endKey) {
            queryParams.endKey = this.idToPrimaryKey(options.endKey);
        } else {
            // For descending scans, end at the lowest possible key.
            const suffix = descending ? ALPHA : OMEGA;
            queryParams.endKey = this.idToPrimaryKey(suffix);
        }

        const result = await this.datastore.queryKeys(queryParams);

        const { Model } = this;

        result.items = result.items.map(({ document }) => {
            return Model.fromRecord(document);
        });

        return result;
    }

    /**
     * Converts a logical item ID to a namespaced datastore key
     *
     * @param {string} id - The item identifier or sentinel value (ALPHA/OMEGA)
     * @returns {string} Namespaced key in format "TypeName__id"
     */
    idToPrimaryKey(id) {
        // Namespace keys by type to allow multiple
        // collection types in same datastore
        // Format: "TypeName__itemId" (e.g., "User__123", "Post__abc")
        return `${ this.type }__${ id }`;
    }
}
