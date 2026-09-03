import { ValidationError } from '../../../../kixx/errors/mod.js';
import { isNonEmptyString } from '../../../../kixx/assertions/mod.js';
import { isValidHash } from '../../../../kixx/content-addressable-store/addressing.js';
import BaseForm from '../base-form.js';
import { normalizeStringAttribute } from '../utils.js';


/**
 * Backs the "assign to running build" control on the Publishing overview and
 * Release detail pages. Every field is a hidden control the page renders with
 * server-derived values; the operator supplies no free text.
 * @extends BaseForm
 */
export default class AssignReleaseForm extends BaseForm {

    /**
     * HttpTarget name used to compile the assign action path.
     * @type {string}
     * @static
     * @readonly
     */
    static target = 'admin-panel/publishing-assign/assign';

    /**
     * HTTP method used for browser form submissions.
     * @type {string}
     * @static
     * @readonly
     */
    static method = 'POST';

    /**
     * JSON Schema for the assign request: the target Release, the build the
     * page was rendered for, and the Release expected to currently be assigned.
     * @type {Object}
     * @static
     * @readonly
     */
    static schema = {
        type: 'object',
        properties: {
            release_id: { type: 'string', fieldType: 'hidden' },
            build_id: { type: 'string', fieldType: 'hidden' },
            expected_release_id: { type: 'string', fieldType: 'hidden' },
        },
        required: [ 'release_id', 'build_id', 'expected_release_id' ],
    };

    /**
     * @param {Object} [attributes] - Raw submitted assign attributes.
     * @param {*} [attributes.release_id] - Release id to assign.
     * @param {*} [attributes.build_id] - Build the page was rendered for.
     * @param {*} [attributes.expected_release_id] - Release expected to be currently assigned.
     */
    constructor(attributes) {
        super();

        const { release_id, build_id, expected_release_id } = attributes ?? {};
        this.release_id = normalizeStringAttribute(release_id);
        this.build_id = normalizeStringAttribute(build_id);
        this.expected_release_id = normalizeStringAttribute(expected_release_id);
    }

    /**
     * Validates that every hidden field was submitted and that the two Release
     * ids are well-formed content hashes, rejecting a forged value before any
     * store read.
     * @returns {void}
     * @throws {ValidationError} When a field is missing or malformed.
     */
    validate() {
        const error = new ValidationError('The assign Release request is invalid');

        if (!isNonEmptyString(this.release_id)) {
            error.push('Release id is required', 'release_id');
        } else if (!isValidHash(this.release_id)) {
            error.push('Release id is malformed', 'release_id');
        }

        if (!isNonEmptyString(this.build_id)) {
            error.push('Build id is required', 'build_id');
        }

        if (!isNonEmptyString(this.expected_release_id)) {
            error.push('Expected Release id is required', 'expected_release_id');
        } else if (!isValidHash(this.expected_release_id)) {
            error.push('Expected Release id is malformed', 'expected_release_id');
        }

        if (error.length) {
            throw error;
        }
    }
}
