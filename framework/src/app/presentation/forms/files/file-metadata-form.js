import BaseForm from '../base-form.js';
import { ValidationError } from '../../../../kixx/errors/mod.js';
import { isString } from '../../../../kixx/assertions/mod.js';
import { normalizeOptionalStringAttribute } from '../utils.js';

/** Validated optional admin-only metadata. */
export default class FileMetadataForm extends BaseForm {

    static target = 'admin-panel/file-metadata/metadata';

    static method = 'POST';

    static schema = {
        type: 'object',
        properties: {
            title: {
                type: [ 'string', 'null' ],
                maxLength: 200,
                label: 'Title',
                fieldType: 'text',
                hint: 'Falls back to the filename when left blank.',
            },
            description: {
                type: [ 'string', 'null' ],
                maxLength: 2000,
                label: 'Description',
                fieldType: 'textarea',
            },
        },
    };

    /**
     * @param {Object} [attributes] - Raw submitted metadata attributes.
     * @param {*} [attributes.title] - Operator-entered title.
     * @param {*} [attributes.description] - Operator-entered description.
     * @param {*} [attributes.fileId] - File identity used only to compile the action URL.
     */
    constructor(attributes) {
        super();
        const { title, description, fileId } = attributes ?? {};
        this.title = normalizeOptionalStringAttribute(title);
        this.description = normalizeOptionalStringAttribute(description);
        // Not a schema field, so it never renders as an input: carried only so
        // getFormContext() can compile the :fileId segment of the action URL.
        this.fileId = fileId;
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
