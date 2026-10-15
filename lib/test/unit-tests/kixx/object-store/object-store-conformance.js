import { assert, assertEqual } from 'kixx-assert';

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

export default function objectStoreConformance(describe, makeStore) {
    describe('exact content length', ({ it }) => {
        it('accepts exact and zero-length bodies', async () => {
            const subject = await makeStore();
            const first = await subject.store.put(subject.context, 'files', 'exact', 'abc', { contentLength: 3 });
            const empty = await subject.store.put(subject.context, 'files', 'empty', '', { contentLength: 0 });

            assertEqual(3, first.contentLength);
            assertEqual(0, empty.contentLength);
            await subject.close();
        });

        it('rejects mismatched sized bodies', async () => {
            const subject = await makeStore();
            const error = await catchAsyncError(() => {
                return subject.store.put(subject.context, 'files', 'mismatch', 'abc', { contentLength: 2 });
            });

            assert(error);
            assertEqual(null, await subject.store.head(subject.context, 'files', 'mismatch'));
            await subject.close();
        });
    });
}
