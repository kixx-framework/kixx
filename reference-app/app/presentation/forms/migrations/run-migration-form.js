import {
    isBoolean,
    isNonEmptyString,
    isUndefined,
} from '../../../../kixx/assertions/mod.js';
import { ValidationError } from '../../../../kixx/errors/mod.js';


/**
 * Normalizes and validates JSON:API migration-run attributes.
 *
 * This form only backs an API endpoint, so it intentionally omits the
 * HTML-form `target`, `method`, and `getFormContext()` machinery.
 */
export default class RunMigrationForm {

    /**
     * JSON Schema for accepted migration-run attributes.
     * @type {Object}
     * @static
     * @readonly
     */
    static schema = {
        type: 'object',
        properties: {
            dryRun: {
                type: 'boolean',
                default: false,
                description: 'Run one preview batch without persisting changes',
            },
            force: {
                type: 'boolean',
                default: false,
                description: 'Restart an applied or failed real migration',
            },
            cursor: {
                type: [ 'string', 'null' ],
                default: null,
                description: 'Opaque dry-run progress cursor',
            },
        },
    };

    /**
     * @param {Object} [attributes] - JSON:API MigrationRun attributes.
     * @param {*} [attributes.dryRun] - Whether to preview one batch.
     * @param {*} [attributes.force] - Whether to restart eligible ledger state.
     * @param {*} [attributes.cursor] - Opaque dry-run cursor or null.
     */
    constructor(attributes) {
        const {
            dryRun,
            force,
            cursor,
        } = attributes ?? {};

        this.dryRun = isUndefined(dryRun) ? false : dryRun;
        this.force = isUndefined(force) ? false : force;
        this.cursor = isUndefined(cursor) ? null : cursor;
    }

    /**
     * Validates migration-run fields and incompatible execution options.
     * @returns {void}
     * @throws {ValidationError} When an attribute is invalid.
     */
    validate() {
        const error = new ValidationError('The migration run form contains invalid fields');

        if (!isBoolean(this.dryRun)) {
            error.push('Dry run must be a boolean', 'dryRun');
        }

        if (!isBoolean(this.force)) {
            error.push('Force must be a boolean', 'force');
        }

        if (this.cursor !== null && !isNonEmptyString(this.cursor)) {
            error.push('Cursor must be null or a non-empty string', 'cursor');
        }

        if (this.dryRun === true && this.force === true) {
            error.push('Force cannot be used during a dry run', 'force');
        }

        if (error.length) {
            throw error;
        }
    }

    /**
     * Returns normalized migration-run fields.
     * @returns {{ dryRun: boolean, force: boolean, cursor: string|null }} Plain JSON form values.
     */
    toJSON() {
        return {
            dryRun: this.dryRun,
            force: this.force,
            cursor: this.cursor,
        };
    }

    /**
     * Creates the form from a parsed JSON:API resource.
     * @param {{ attributes: Object }} resource - Parsed resource from parseJsonApiResource().
     * @returns {RunMigrationForm} Hydrated migration-run form.
     */
    static fromJsonApi(resource) {
        const { attributes } = resource ?? {};
        return new RunMigrationForm(attributes);
    }
}
