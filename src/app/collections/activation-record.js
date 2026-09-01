import Record from './base-document-store-record.js';
import { ValidationError } from '../../kixx/errors/mod.js';
import { isNonEmptyString } from '../../kixx/assertions/mod.js';
import { isIsoDateTime } from '../lib/iso-date-time.js';


export const ACTIVATION_REASONS = new Set([
    'publish',
    'rollback',
    'carry-forward',
    'restore',
]);


/**
 * Append-only audit metadata for one successful Release assignment.
 * @extends Record
 */
export default class ActivationRecord extends Record {

    static schema = {
        type: 'object',
        properties: {
            buildId: { type: 'string' },
            fromReleaseId: { type: [ 'string', 'null' ] },
            toReleaseId: { type: 'string' },
            activatedAt: { type: 'string', format: 'date-time' },
            activatedBy: { type: 'string' },
            reason: { type: 'string', enum: [ ...ACTIVATION_REASONS ] },
            buildActivationKey: { type: 'string' },
        },
        required: [
            'buildId',
            'fromReleaseId',
            'toReleaseId',
            'activatedAt',
            'activatedBy',
            'reason',
            'buildActivationKey',
        ],
    };

    /**
     * Validates activation identity and audit fields.
     * @returns {void}
     * @throws {ValidationError} When one or more attributes are invalid.
     */
    validate() {
        const error = new ValidationError('Invalid Activation record');
        const fromReleaseId = this.get('fromReleaseId');

        if (!isNonEmptyString(this.get('buildId'))) {
            error.push('Activation buildId is required', 'buildId');
        }
        if (fromReleaseId !== null && !isNonEmptyString(fromReleaseId)) {
            error.push('Activation fromReleaseId must be a non-empty string or null', 'fromReleaseId');
        }
        if (!isNonEmptyString(this.get('toReleaseId'))) {
            error.push('Activation toReleaseId is required', 'toReleaseId');
        }
        if (!isIsoDateTime(this.get('activatedAt'))) {
            error.push('Activation activatedAt must be a valid date', 'activatedAt');
        }
        if (!isNonEmptyString(this.get('activatedBy'))) {
            error.push('Activation activatedBy is required', 'activatedBy');
        }
        if (!ACTIVATION_REASONS.has(this.get('reason'))) {
            error.push('Activation reason is invalid', 'reason');
        }
        if (!isNonEmptyString(this.get('buildActivationKey'))) {
            error.push('Activation buildActivationKey is required', 'buildActivationKey');
        }

        if (error.length) {
            throw error;
        }
    }
}
