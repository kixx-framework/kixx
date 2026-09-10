import BaseForm from '../base-form.js';
import { ValidationError, PayloadTooLargeError } from '../../../../kixx/errors/mod.js';
import { isNonEmptyString } from '../../../../kixx/assertions/mod.js';
import { getContentType } from '../../../../kixx/static-assets/mime-types.js';

// deno-lint-ignore no-control-regex
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/u; // eslint-disable-line no-control-regex

/** Validated transport values for a raw file upload or replacement. */
export default class UploadFileForm extends BaseForm {

    static schema = {
        type: 'object',
        properties: {
            filename: { type: 'string' },
            contentType: { type: 'string' },
            contentLength: { type: 'integer', minimum: 0 },
        },
        required: [ 'filename', 'contentType', 'contentLength' ],
    };

    constructor(attributes) {
        super();
        const { filename, contentType, contentLength, body, maxUploadBytes } = attributes ?? {};
        this.filename = normalizeFilename(filename);
        // Browser-supplied MIME values are untrusted. The shared extension map
        // provides the same deterministic type on every runtime.
        this.contentType = isNonEmptyString(this.filename) ? getContentType(this.filename) : contentType;
        this.contentLength = contentLength;
        this.body = body;
        this.maxUploadBytes = maxUploadBytes;
    }

    /** @returns {void} @throws {ValidationError|PayloadTooLargeError} When upload input is invalid. */
    validate() {
        const error = new ValidationError('The file upload is invalid');
        if (!isNonEmptyString(this.filename)) {
            error.push('Filename is required', 'filename');
        }
        if (!isNonEmptyString(this.contentType)) {
            error.push('Content type is required', 'contentType');
        }
        if (!Number.isSafeInteger(this.contentLength) || this.contentLength < 0) {
            error.push('Content length must be a nonnegative integer', 'contentLength');
        }
        if (!this.body) {
            error.push('File body is required', 'body');
        }
        if (error.length) {
            throw error;
        }
        if (Number.isSafeInteger(this.maxUploadBytes) && this.contentLength > this.maxUploadBytes) {
            throw new PayloadTooLargeError(`File exceeds the ${ this.maxUploadBytes } byte upload limit`, {
                code: 'FileUploadTooLarge',
            });
        }
    }
}

function normalizeFilename(value) {
    if (!isNonEmptyString(value)) {
        return value;
    }
    const filename = value.replaceAll('\\', '/').split('/').pop().trim();
    // Control characters can become invalid response headers when the original
    // filename is later used for download disposition.
    return CONTROL_CHAR_PATTERN.test(filename) ? null : filename;
}
