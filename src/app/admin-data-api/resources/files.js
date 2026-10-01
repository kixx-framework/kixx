import FileRecord from '../../collections/file-record.js';


const FILE_SCHEMA = FileRecord.schema.properties;

// FileRecord.schema only says `content` is an object; FileRecord#validate()
// enforces the fields below and rejects any others. Publish them here so discovery tells a client
// what a valid content reference looks like.
const CONTENT_SCHEMA = {
    type: 'object',
    properties: {
        key: { type: 'string', minLength: 1 },
        filename: { type: 'string', minLength: 1 },
        contentType: { type: 'string', minLength: 1 },
        etag: { type: 'string', minLength: 1 },
        generation: { type: 'string', format: 'uuid' },
        length: { type: 'integer', minimum: 0 },
    },
    required: [ 'key', 'filename', 'contentType', 'etag', 'generation', 'length' ],
    additionalProperties: false,
};

/**
 * Record-only File resource. The API edits File documents and their content
 * references; it never uploads, copies, replaces, or deletes the bytes those
 * references name. See docs/admin-data-api.md, "Files".
 * @type {Object}
 */
export default {
    type: 'files',
    collection: 'File',
    description: 'File metadata records and their content references. Record-only: '
        + 'binary content is never uploaded, copied, or deleted by this API, and a '
        + 'content reference is validated for shape, not for existence.',
    attributes: {
        title: {
            description: 'Display title, or null.',
            schema: FILE_SCHEMA.title,
        },
        description: {
            description: 'Longer description, or null.',
            schema: FILE_SCHEMA.description,
        },
        isPublished: {
            description: 'Whether the file is served publicly.',
            schema: FILE_SCHEMA.isPublished,
        },
        originalUploadedAt: {
            description: 'Server-assigned creation time; for records created through this API, the record creation time.',
            schema: FILE_SCHEMA.originalUploadedAt,
        },
        content: {
            description: 'Reference to existing stored content. Replaced as a whole on update.',
            schema: CONTENT_SCHEMA,
        },
    },
    operations: {
        list: {
            sorts: [
                {
                    name: '-originalUploadedAt',
                    description: 'Newest upload first.',
                    descending: true,
                },
            ],
        },
        get: {},
        create: {
            attributes: [ 'title', 'description', 'isPublished', 'content' ],
            required: [ 'title', 'description', 'isPublished', 'content' ],
            // createFile() assigns originalUploadedAt and the immutable
            // upload-order sort key the newest-first list depends on.
            async persist(context, collection, attributes) {
                return await collection.createFile(context, Object.assign({}, attributes, {
                    id: crypto.randomUUID(),
                }));
            },
        },
        update: {
            attributes: [ 'title', 'description', 'isPublished', 'content' ],
        },
        delete: {},
    },
};
