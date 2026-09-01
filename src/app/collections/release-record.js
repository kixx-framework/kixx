import Record from './base-document-store-record.js';
import { ValidationError } from '../../kixx/errors/mod.js';
import {
    isNonEmptyString,
    isNumberNotNaN,
    isPlainObject,
} from '../../kixx/assertions/mod.js';
import { isIsoDateTime } from '../lib/iso-date-time.js';


const PROVENANCE_FIELDS = new Set([
    'sourceRevision',
    'message',
    'client',
    'intendedForBuildId',
]);


/**
 * Validates optional immutable publishing provenance.
 * @param {Object} provenance - Provenance submitted with a Release.
 * @returns {void}
 * @throws {ValidationError} When provenance has an invalid shape or field.
 */
export function validateReleaseProvenance(provenance) {
    const error = new ValidationError('Invalid Release provenance');
    validateProvenance(provenance, error);
    if (error.length) {
        throw error;
    }
}


/**
 * Immutable audit metadata for a content-addressed Release.
 * @extends Record
 */
export default class ReleaseRecord extends Record {

    static schema = {
        type: 'object',
        properties: {
            releaseId: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            createdBy: { type: 'string' },
            objectCount: { type: 'integer', minimum: 0 },
            totalBytes: { type: 'integer', minimum: 0 },
            contractVersion: { type: 'integer', minimum: 1 },
            provenance: {
                type: 'object',
                properties: {
                    sourceRevision: { type: 'string' },
                    message: { type: 'string' },
                    client: { type: 'string' },
                    intendedForBuildId: { type: 'string' },
                },
            },
        },
        required: [
            'releaseId',
            'createdAt',
            'createdBy',
            'objectCount',
            'totalBytes',
            'contractVersion',
            'provenance',
        ],
    };

    /**
     * Validates Release identity, aggregate statistics, and provenance.
     * @returns {void}
     * @throws {ValidationError} When one or more attributes are invalid.
     */
    validate() {
        const error = new ValidationError('Invalid Release record');
        const provenance = this.get('provenance');

        if (!isNonEmptyString(this.get('releaseId'))) {
            error.push('Release releaseId is required', 'releaseId');
        }
        if (!isIsoDateTime(this.get('createdAt'))) {
            error.push('Release createdAt must be a valid date', 'createdAt');
        }
        if (!isNonEmptyString(this.get('createdBy'))) {
            error.push('Release createdBy is required', 'createdBy');
        }
        validateNonNegativeInteger(this.get('objectCount'), 'objectCount', error);
        validateNonNegativeInteger(this.get('totalBytes'), 'totalBytes', error);
        if (!Number.isInteger(this.get('contractVersion')) || this.get('contractVersion') < 1) {
            error.push('Release contractVersion must be a positive integer', 'contractVersion');
        }
        validateProvenance(provenance, error);

        if (error.length) {
            throw error;
        }
    }
}

function validateNonNegativeInteger(value, field, error) {
    if (!isNumberNotNaN(value) || !Number.isInteger(value) || value < 0) {
        error.push(`Release ${ field } must be a non-negative integer`, field);
    }
}

function validateProvenance(provenance, error) {
    if (!isPlainObject(provenance)) {
        error.push('Release provenance must be an object', 'provenance');
        return;
    }

    for (const field of Object.keys(provenance)) {
        if (!PROVENANCE_FIELDS.has(field)) {
            error.push(`Unknown Release provenance field "${ field }"`, `provenance.${ field }`);
        } else if (!isNonEmptyString(provenance[field])) {
            error.push(`Release provenance ${ field } must be a non-empty string`, `provenance.${ field }`);
        }
    }
}
