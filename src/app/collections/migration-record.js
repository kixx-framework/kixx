import Record from './base-document-store-record.js';
import { ValidationError } from '../../kixx/errors/mod.js';
import {
    isNonEmptyString,
    isPlainObject,
    isValidDate,
} from '../../kixx/assertions/mod.js';


const VALID_STATUSES = new Set([ 'running', 'applied', 'failed' ]);
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;


/**
 * Durable progress and lifecycle state for one registered data migration.
 *
 * The record id is the migration registry id. Stored cursors represent only
 * successfully committed batches and are guarded by document-store versions.
 * @extends Record
 */
export default class MigrationRecord extends Record {

    static schema = {
        type: 'object',
        properties: {
            status: {
                type: 'string',
                enum: [ 'running', 'applied', 'failed' ],
                description: 'Persisted migration lifecycle state',
            },
            cursor: {
                type: [ 'string', 'null' ],
                description: 'Opaque cursor from the last committed batch',
            },
            stats: {
                type: 'object',
                additionalProperties: { type: 'number' },
                description: 'Finite counters accumulated across committed batches',
            },
            batchCount: {
                type: 'integer',
                minimum: 0,
                description: 'Number of successfully committed batches',
            },
            startedBy: {
                type: 'string',
                description: 'Stable admin id that started the current run',
            },
            startedAt: {
                type: 'string',
                format: 'date-time',
                description: 'ISO timestamp when the current run began',
            },
            lastBatchAt: {
                type: [ 'string', 'null' ],
                format: 'date-time',
                description: 'ISO timestamp of the most recent committed batch',
            },
            completedAt: {
                type: [ 'string', 'null' ],
                format: 'date-time',
                description: 'ISO timestamp when the run applied or failed',
            },
            error: {
                type: [ 'string', 'null' ],
                description: 'Client-safe failure message for a failed run',
            },
        },
        required: [
            'status',
            'cursor',
            'stats',
            'batchCount',
            'startedBy',
            'startedAt',
            'lastBatchAt',
            'completedAt',
            'error',
        ],
    };

    validate() {
        const error = new ValidationError('Invalid migration ledger record');

        validateFieldShapes(this, error);
        validateLifecycle(this, error);

        if (error.length) {
            throw error;
        }
    }

    get status() {
        return this.get('status');
    }

    get cursor() {
        return this.get('cursor');
    }

    get stats() {
        return this.get('stats');
    }

    get batchCount() {
        return this.get('batchCount');
    }

    get startedBy() {
        return this.get('startedBy');
    }

    get startedAt() {
        return this.get('startedAt');
    }

    get lastBatchAt() {
        return this.get('lastBatchAt');
    }

    get completedAt() {
        return this.get('completedAt');
    }

    get error() {
        return this.get('error');
    }
}

function validateFieldShapes(record, error) {
    const cursor = record.get('cursor');
    const stats = record.get('stats');
    const batchCount = record.get('batchCount');
    const lastBatchAt = record.get('lastBatchAt');
    const completedAt = record.get('completedAt');
    const failureMessage = record.get('error');

    if (!VALID_STATUSES.has(record.get('status'))) {
        error.push('Migration status must be running, applied, or failed', 'status');
    }
    if (cursor !== null && !isNonEmptyString(cursor)) {
        error.push('Migration cursor must be a non-empty string or null', 'cursor');
    }
    if (!isPlainObject(stats) || !Object.values(stats).every(Number.isFinite)) {
        error.push('Migration stats must be a plain object of finite numbers', 'stats');
    }
    if (!Number.isInteger(batchCount) || batchCount < 0) {
        error.push('Migration batchCount must be a non-negative integer', 'batchCount');
    }
    if (!isNonEmptyString(record.get('startedBy'))) {
        error.push('Migration startedBy is required', 'startedBy');
    }
    if (!isIsoDateTime(record.get('startedAt'))) {
        error.push('Migration startedAt must be a valid ISO date-time', 'startedAt');
    }
    if (lastBatchAt !== null && !isIsoDateTime(lastBatchAt)) {
        error.push('Migration lastBatchAt must be a valid ISO date-time or null', 'lastBatchAt');
    }
    if (completedAt !== null && !isIsoDateTime(completedAt)) {
        error.push('Migration completedAt must be a valid ISO date-time or null', 'completedAt');
    }
    if (failureMessage !== null && !isNonEmptyString(failureMessage)) {
        error.push('Migration error must be a non-empty string or null', 'error');
    }
    if (batchCount === 0 && lastBatchAt !== null) {
        error.push('Migration lastBatchAt must be null before the first committed batch', 'lastBatchAt');
    }
}

function validateLifecycle(record, error) {
    const status = record.get('status');
    const cursor = record.get('cursor');
    const completedAt = record.get('completedAt');
    const failureMessage = record.get('error');

    if (status === 'running') {
        if (completedAt !== null) {
            error.push('Running migrations cannot have completedAt set', 'completedAt');
        }
        if (failureMessage !== null) {
            error.push('Running migrations cannot have an error', 'error');
        }
    }

    if (status === 'applied') {
        if (cursor !== null) {
            error.push('Applied migrations must have a null cursor', 'cursor');
        }
        if (!isIsoDateTime(completedAt)) {
            error.push('Applied migrations must have completedAt set', 'completedAt');
        }
        if (failureMessage !== null) {
            error.push('Applied migrations cannot have an error', 'error');
        }
    }

    if (status === 'failed') {
        if (!isIsoDateTime(completedAt)) {
            error.push('Failed migrations must have completedAt set', 'completedAt');
        }
        if (!isNonEmptyString(failureMessage)) {
            error.push('Failed migrations must have a non-empty error', 'error');
        }
    }
}

function isIsoDateTime(value) {
    if (!isNonEmptyString(value) || !ISO_DATE_TIME_PATTERN.test(value)) {
        return false;
    }

    return isValidDate(new Date(value));
}
