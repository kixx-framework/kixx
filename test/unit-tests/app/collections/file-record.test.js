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

    it('rejects content reference members it does not define', () => {
        const record = makeRecord();
        const content = Object.assign({}, record.get('content'), { ownerId: 'someone' });
        const error = catchError(() => makeRecord({ content }).validate());
        assert(error);
        assertEqual(1, error.errors.length);
        assertEqual('content.ownerId', error.errors[0].source);
    });

    it('rejects content types that cannot safely become download headers', () => {
        for (const contentType of [ 'image/png\r\nX-Test: bad', 'text/plain\u0000', 'text/\u0100' ]) {
            const record = makeRecord();
            record.set('content', Object.assign({}, record.get('content'), { contentType }));

            const error = catchError(() => record.validate());
            assert(error);
            assertEqual('ValidationError', error.name);
            assertEqual('content.contentType', error.errors[0].source);
        }
    });

    it('rejects filenames that cannot be encoded for download disposition', () => {
        for (const filename of [ '\ud800.txt', 'file\udfff.txt' ]) {
            const record = makeRecord();
            record.set('content', Object.assign({}, record.get('content'), { filename }));

            const error = catchError(() => record.validate());
            assert(error);
            assertEqual('ValidationError', error.name);
            assertEqual('content.filename', error.errors[0].source);
        }
    });

    it('accepts Unicode filenames and content types with parameters', () => {
        const record = makeRecord();
        record.set('content', Object.assign({}, record.get('content'), {
            filename: 'café-📄.txt',
            contentType: 'text/plain; charset=utf-8',
        }));

        assertEqual(undefined, record.validate());
    });
});
