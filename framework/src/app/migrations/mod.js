import { migrate as exampleNoop } from './2026-07-17-example-noop.js';
import {
    assert,
    assertFunction,
    assertNonEmptyString,
    isPlainObject,
} from '../../kixx/assertions/mod.js';


const MIGRATION_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXAMPLE_NOOP_ID = '2026-07-17-example-noop';


/**
 * Statically registered migrations in operator-facing list order.
 * @type {Map<string, {id: string, description: string, migrate: Function}>}
 */
export const migrations = new Map([
    [ EXAMPLE_NOOP_ID, {
        id: EXAMPLE_NOOP_ID,
        description: 'Verify the remote migration workflow without reading or changing application data.',
        migrate: exampleNoop,
    } ],
]);

/**
 * Resolves a statically registered migration after validating the full registry.
 * @param {string} id - Permanent migration id.
 * @param {Map} [registry] - Registry to validate and search; defaults to the application registry.
 * @returns {{id: string, description: string, migrate: Function}|null} Registry entry, or null when absent.
 * @throws {AssertionError} When the registry contract or id argument is invalid.
 */
export function getMigration(id, registry = migrations) {
    validateMigrationRegistry(registry);
    assertNonEmptyString(id, 'getMigration() id');
    return registry.get(id) ?? null;
}

/**
 * Lists validated migrations in static registry iteration order.
 * @param {Map} [registry] - Registry to validate and list; defaults to the application registry.
 * @returns {Array<{id: string, description: string, migrate: Function}>} Registered entries in deployment order.
 * @throws {AssertionError} When the registry contract is invalid.
 */
export function listMigrations(registry = migrations) {
    validateMigrationRegistry(registry);
    return Array.from(registry.values());
}

/**
 * Validates every entry before registry data is used for lookup or ledger access.
 * @param {Map} registry - Migration registry to validate.
 * @returns {void}
 * @throws {AssertionError} When any registry key or entry violates the migration contract.
 */
export function validateMigrationRegistry(registry) {
    assert(registry instanceof Map, 'validateMigrationRegistry() registry must be a Map');

    for (const [ key, entry ] of registry) {
        assertNonEmptyString(key, 'validateMigrationRegistry() registry key');
        assert(
            isPlainObject(entry),
            `validateMigrationRegistry() entry for "${ key }" must be a plain object`,
        );
        assert(
            key === entry.id,
            `validateMigrationRegistry() key "${ key }" must equal entry.id "${ entry.id }"`,
        );
        assert(
            MIGRATION_ID_PATTERN.test(entry.id),
            `validateMigrationRegistry() entry.id "${ entry.id }" must use YYYY-MM-DD-short-kebab-description format`,
        );
        assertNonEmptyString(
            entry.description,
            `validateMigrationRegistry() entry.description for "${ key }"`,
        );
        assertFunction(
            entry.migrate,
            `validateMigrationRegistry() entry.migrate for "${ key }"`,
        );
    }
}
