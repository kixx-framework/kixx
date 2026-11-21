import BaseForm from '../base-form.js';
import { ValidationError } from '../../../../kixx/errors/mod.js';
import { isNonEmptyString } from '../../../../kixx/assertions/mod.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Validates the stable identity used by file mutation scripts. */
export default class FileActionForm extends BaseForm {

    static schema = {
        type: 'object',
        properties: { fileId: { type: 'string', format: 'uuid' } },
        required: [ 'fileId' ],
    };

    constructor(attributes) {
        super();
        this.fileId = attributes?.fileId;
    }

    /** @returns {void} @throws {ValidationError} When the identity is malformed. */
    validate() {
        if (!isNonEmptyString(this.fileId) || !UUID_PATTERN.test(this.fileId)) {
            const error = new ValidationError('The file action is invalid');
            error.push('File id must be a UUID', 'fileId');
            throw error;
        }
    }
}
