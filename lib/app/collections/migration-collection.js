import Collection from './base-document-store-collection.js';
import MigrationRecord from './migration-record.js';
import {
    assert,
    assertNonEmptyString,
    isPlainObject,
} from '../../kixx/assertions/mod.js';


/**
 * Table Data Gateway for durable migration progress records.
 *
 * Lifecycle writes deliberately expose only create and version-guarded update
 * helpers so concurrent drivers cannot overwrite or auto-merge ledger advances.
 * @extends Collection
 */
export default class MigrationCollection extends Collection {

    static TYPE = 'Migration';

    static Record = MigrationRecord;

    /**
     * Loads ledger state using the migration registry id.
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {string} id - Registered migration id.
     * @returns {Promise<MigrationRecord|null>} Stored progress, or null before the first real run.
     * @throws {AssertionError} When id is not a non-empty string.
     */
    async getByMigrationId(context, id) {
        assertNonEmptyString(id, 'MigrationCollection#getByMigrationId() id');
        return await this.get(context, id);
    }

    /**
     * Creates the first durable ledger state for a migration.
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {string} id - Registered migration id used as the record id.
     * @param {Object} attributes - Complete initial ledger attributes.
     * @returns {Promise<MigrationRecord>} The created progress record.
     * @throws {AssertionError} When id or attributes are invalid.
     * @throws {ValidationError} When the ledger attributes violate record invariants.
     * @throws {DocumentAlreadyExistsError} When another driver created the ledger first.
     */
    async createLedgerRecord(context, id, attributes) {
        assertNonEmptyString(id, 'MigrationCollection#createLedgerRecord() id');
        assert(
            isPlainObject(attributes),
            'MigrationCollection#createLedgerRecord() attributes must be a plain object',
        );
        return await this.create(context, { ...attributes, id });
    }

    /**
     * Persists a prepared ledger transition using optimistic concurrency.
     * @param {Object} context - Request or execution context passed through to the document store.
     * @param {MigrationRecord} record - Previously loaded record carrying the expected version.
     * @returns {Promise<MigrationRecord>} The committed progress record.
     * @throws {ValidationError} When the transition violates record invariants.
     * @throws {VersionConflictError} When another driver advanced the ledger first.
     * @throws {DocumentNotFoundError} When the ledger record no longer exists.
     */
    async updateLedgerRecord(context, record) {
        return await this.update(context, record);
    }
}
