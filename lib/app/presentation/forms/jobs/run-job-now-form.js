import { isString, isUndefined } from '../../../../kixx/assertions/mod.js';
import { ValidationError } from '../../../../kixx/errors/mod.js';
import BaseForm from '../base-form.js';
import { normalizeStringAttribute } from '../utils.js';


/**
 * Backs the per-job "Run now" control on the admin Registered jobs page.
 *
 * The payload is kept exactly as submitted so a rejected submission
 * re-renders the operator's text unchanged; the parsed value is stored
 * separately in `payloadValue`. The name is not validated here: whether it is
 * registered is a rule owned by `runJobNow()`.
 * @extends BaseForm
 */
export default class RunJobNowForm extends BaseForm {

    /**
     * HttpTarget name used to compile the run-now action path.
     * @type {string}
     * @static
     * @readonly
     */
    static target = 'admin-panel/job-registry/run-now';

    /**
     * HTTP method used for browser form submissions.
     * @type {string}
     * @static
     * @readonly
     */
    static method = 'POST';

    /**
     * JSON Schema for the run-now request.
     * @type {Object}
     * @static
     * @readonly
     */
    static schema = {
        type: 'object',
        properties: {
            name: { type: 'string', fieldType: 'hidden' },
            payload: { type: 'string', fieldType: 'textarea', label: 'Payload (JSON)' },
        },
        required: [ 'name', 'payload' ],
    };

    /**
     * @param {Object} [attributes] - Raw submitted attributes.
     * @param {*} [attributes.name] - Registered job name.
     * @param {*} [attributes.payload] - JSON payload text; defaults to `{}`.
     */
    constructor(attributes) {
        super();

        const { name, payload } = attributes ?? {};

        this.name = normalizeStringAttribute(name);
        this.payload = isUndefined(payload) ? '{}' : payload;
        this.payloadValue = undefined;
    }

    /**
     * Parses the payload text and stores the result in `payloadValue`.
     * @returns {void}
     * @throws {ValidationError} When the payload is not text, is blank, or is not valid JSON.
     */
    validate() {
        const error = new ValidationError('The run now request is invalid');

        if (!isString(this.payload)) {
            error.push('The payload must be text.', 'payload');
        } else if (this.payload.trim().length === 0) {
            error.push('Enter a JSON payload. Use {} for an empty payload.', 'payload');
        } else {
            try {
                this.payloadValue = JSON.parse(this.payload);
            } catch {
                // The parser's message can quote input, so it is never shown.
                error.push('The payload must be valid JSON.', 'payload');
            }
        }

        if (error.length) {
            throw error;
        }
    }
}
