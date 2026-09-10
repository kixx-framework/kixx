import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import FileRecord from '../../../../../src/app/collections/file-record.js';
import { replaceFile } from '../../../../../src/app/transaction-scripts/files/replace-file.js';

function makeRecord(contentKey, isPublished) {
    return FileRecord.forWrite({
        type: 'File',
        id: '3d3805fa-f652-4c5d-a62a-ce24e36e696a',
        sortKey: 'stable',
        attributes: {
            title: 'Title',
            description: 'Description',
            isPublished,
            originalUploadedAt: '2026-09-10T12:00:00.000Z',
            content: {
                key: contentKey,
                filename: 'old.txt',
                contentType: 'text/plain',
                length: 3,
                etag: 'old',
                generation: 'a88a54e6-4208-4af8-a86d-98dfca8a332d',
            },
        },
    });
}

describe('replaceFile', ({ it }) => {
    it('merges onto the latest record and cleans up the displaced content', async () => {
        const initial = makeRecord('file/original', true);
        const concurrent = makeRecord('file/concurrent', false);
        const deleted = [];
        const content = {
            key: 'file/replacement',
            filename: 'new.txt',
            contentType: 'text/plain',
            length: 3,
            etag: 'new',
            generation: '4074e9f5-c3cf-4574-b773-fee64fb3ad44',
        };
        const collections = {
            File: {
                async getFile() {
                    return initial;
                },
                async updateWithRetry(_context, _record, callback) {
                    return await callback(concurrent);
                },
            },
            FileContent: {
                async create() {
                    return content;
                },
                async delete(_context, key) {
                    deleted.push(key);
                },
            },
        };
        const context = {
            getCollection(name) {
                return collections[name];
            },
        };
        const form = {
            filename: 'new.txt',
            contentType: 'text/plain',
            contentLength: 3,
            body: new Blob([ 'new' ]).stream(),
            validate() {},
        };

        const result = await replaceFile(context, initial.id, form);

        assertEqual(false, result.isPublished);
        assertEqual('Title', result.title);
        assertEqual('file/replacement', result.content.key);
        assertEqual('file/concurrent', deleted[0]);
    });
});
