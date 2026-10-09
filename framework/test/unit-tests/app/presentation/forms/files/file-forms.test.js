import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import FileMetadataForm from '../../../../../../src/app/presentation/forms/files/file-metadata-form.js';
import UploadFileForm from '../../../../../../src/app/presentation/forms/files/upload-file-form.js';

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

describe('File forms', ({ it }) => {
    it('normalizes blank metadata to null', () => {
        const form = new FileMetadataForm({ title: '  ', description: '' });
        form.validate();
        assertEqual(null, form.title);
        assertEqual(null, form.description);
    });

    it('accepts a zero-byte upload', () => {
        const form = new UploadFileForm({
            filename: 'empty.txt',
            contentType: 'text/plain',
            contentLength: 0,
            body: new ReadableStream({
                start(controller) {
                    controller.close();
                },
            }),
            maxUploadBytes: 50,
        });
        assertEqual(undefined, form.validate());
    });

    it('treats the null body of an empty request as zero bytes', () => {
        const form = new UploadFileForm({
            filename: 'empty.txt',
            contentType: 'text/plain',
            contentLength: 0,
            body: null,
            maxUploadBytes: 50,
        });
        assertEqual(undefined, form.validate());
        assertEqual(0, form.body.byteLength);
    });

    it('still requires a body for a nonzero declared length', () => {
        const form = new UploadFileForm({
            filename: 'missing.txt',
            contentType: 'text/plain',
            contentLength: 5,
            body: null,
            maxUploadBytes: 50,
        });
        const error = catchError(() => form.validate());
        assert(error);
        assertEqual('ValidationError', error.name);
    });

    it('reports configured size violations as payload-too-large errors', () => {
        const form = new UploadFileForm({
            filename: 'large.txt',
            contentType: 'text/plain',
            contentLength: 51,
            body: new Blob([ 'x' ]).stream(),
            maxUploadBytes: 50,
        });
        const error = catchError(() => form.validate());
        assert(error);
        assertEqual(413, error.httpStatusCode);
    });
});
