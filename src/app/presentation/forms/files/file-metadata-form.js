import BaseForm from '../base-form.js';
import { ValidationError } from '../../../../kixx/errors/mod.js';
import { isString } from '../../../../kixx/assertions/mod.js';
import { normalizeOptionalStringAttribute } from '../utils.js';

/** Validated optional admin-only metadata. */
export default class FileMetadataForm extends BaseForm {

    static schema = {
        type: 'object',
        properties: {
            title: { type: [ 'string', 'null' ], maxLength: 200 },
            description: { type: [ 'string', 'null' ], maxLength: 2000 },
        },
    };

    constructor(attributes) {
        super();
        const { title, description } = attributes ?? {};
        this.title = normalizeOptionalStringAttribute(title);
        this.description = normalizeOptionalStringAttribute(description);
    }

    /** @returns {void} @throws {ValidationError} When metadata exceeds its bounds. */
    validate() {
        const error = new ValidationError('The file metadata is invalid');
        if (this.title !== null && (!isString(this.title) || this.title.length > 200)) {
            error.push('Title must be at most 200 characters', 'title');
        }
        if (this.description !== null && (!isString(this.description) || this.description.length > 2000)) {
            error.push('Description must be at most 2,000 characters', 'description');
        }
        if (error.length) {
            throw error;
        }
    }
}
