import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import FileRecord from '../../../../src/app/collections/file-record.js';

function makeRecord(overrides) {
    return FileRecord.forWrite({
        type: 'File',
        id: crypto.randomUUID(),
        sortKey: '2026-09-10T12:00:00.000Z:id',
        attributes: Object.assign({
            title: null,
            description: null,
            isPublished: false,
            originalUploadedAt: '2026-09-10T12:00:00.000Z',
            content: {
                key: 'id/generation',
                filename: 'file.txt',
                contentType: 'text/plain',
                length: 0,
                etag: 'etag',
                generation: crypto.randomUUID(),
            },
        }, overrides),
    });
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

describe('FileRecord', ({ it }) => {
    it('accepts zero-byte unpublished files', () => {
        assertEqual(undefined, makeRecord().validate());
    });

    it('rejects metadata beyond its bounds', () => {
        const error = catchError(() => makeRecord({ title: 'x'.repeat(201) }).validate());
        assert(error);
        assertEqual('title', error.errors[0].source);
    });
});
