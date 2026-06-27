import {
    isNonEmptyString,
    isPlainObject,
} from '../../../../kixx/assertions/mod.js';
import { ValidationError } from '../../../../kixx/errors/mod.js';


/**
 * Normalizes and validates JSON:API page metadata attributes.
 */
export default class PutPageMetadataForm {

    /**
     * JSON Schema for page metadata writes.
     * @type {Object}
     * @static
     * @readonly
     */
    static schema = {
        type: 'object',
        properties: {
            version: {
                type: 'string',
                description: 'Required page content version used by live-build cache keys',
            },
        },
        required: [ 'version' ],
        additionalProperties: true,
    };

    /**
     * @param {*} attributes - JSON:API PageMetadata attributes.
     */
    constructor(attributes) {
        this.metadata = isPlainObject(attributes) ? structuredClone(attributes) : attributes;
    }

    /**
     * Validates the page metadata bag.
     * @returns {void}
     * @throws {ValidationError} When metadata is not an object or has no version.
     */
    validate() {
        const error = new ValidationError('The page metadata form contains invalid fields');

        if (!isPlainObject(this.metadata)) {
            error.push('Page metadata attributes must be an object', 'attributes');
        } else if (!isNonEmptyString(this.metadata.version)) {
            error.push('Page metadata version is required', 'version');
        }

        if (error.length) {
            throw error;
        }
    }

    /**
     * Returns the full page metadata bag.
     * @returns {Object} Page metadata attributes.
     */
    toJSON() {
        return structuredClone(this.metadata);
    }

    /**
     * Creates the form from a parsed JSON:API resource.
     * @param {{ attributes: Object }} resource - Parsed resource from parseJsonApiResource().
     * @returns {PutPageMetadataForm} Hydrated page metadata form.
     */
    static fromJsonApi(resource) {
        const { attributes } = resource ?? {};
        return new PutPageMetadataForm(attributes);
    }
}
