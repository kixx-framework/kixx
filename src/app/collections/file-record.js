import Record from './base-document-store-record.js';
import { ValidationError } from '../../kixx/errors/mod.js';
import {
    isBoolean,
    isNonEmptyString,
    isPlainObject,
    isString,
} from '../../kixx/assertions/mod.js';
import { isIsoDateTime } from '../lib/iso-date-time.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Stored metadata and the active immutable object reference for an admin file. */
export default class FileRecord extends Record {

    static schema = {
        type: 'object',
        properties: {
            title: { type: [ 'string', 'null' ], maxLength: 200 },
            description: { type: [ 'string', 'null' ], maxLength: 2000 },
            isPublished: { type: 'boolean' },
            originalUploadedAt: { type: 'string', format: 'date-time' },
            content: { type: 'object' },
        },
        required: [ 'title', 'description', 'isPublished', 'originalUploadedAt', 'content' ],
    };

    /** @returns {void} @throws {ValidationError} When the record shape is invalid. */
    validate() {
        const error = new ValidationError('Invalid File record');
        validateOptionalText(error, this.get('title'), 'title', 200);
        validateOptionalText(error, this.get('description'), 'description', 2000);

        if (!isBoolean(this.get('isPublished'))) {
            error.push('File publication state must be boolean', 'isPublished');
        }
        if (!isIsoDateTime(this.get('originalUploadedAt'))) {
            error.push('File original upload date must be valid', 'originalUploadedAt');
        }
        validateContent(error, this.get('content'));

        if (error.length) {
            throw error;
        }
    }
}

function validateOptionalText(error, value, field, maximum) {
    if (value !== null && (!isString(value) || value.length > maximum)) {
        error.push(`File ${ field } must be null or at most ${ maximum } characters`, field);
    }
}

function validateContent(error, content) {
    if (!isPlainObject(content)) {
        error.push('File content must be an object', 'content');
        return;
    }
    for (const field of [ 'key', 'filename', 'contentType', 'etag', 'generation' ]) {
        if (!isNonEmptyString(content[field])) {
            error.push(`File content ${ field } is required`, `content.${ field }`);
        }
    }
    if (!Number.isSafeInteger(content.length) || content.length < 0) {
        error.push('File content length must be a nonnegative safe integer', 'content.length');
    }
    if (isNonEmptyString(content.generation) && !UUID_PATTERN.test(content.generation)) {
        error.push('File content generation must be a UUID', 'content.generation');
    }
}
