import { describe } from 'kixx-test';
import { assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';
import { readWorkerRecord } from '../../../lib/cloudflare/worker-record.js';


describe('readWorkerRecord()', ({ describe }) => {

    describe('deployment state', ({ it }) => {
        it('reads a null deployed_on as never deployed', () => {
            assertEqual(false, readWorkerRecord({ deployed_on: null }, 'my-worker').deployed);
        });

        it('reads a timestamp as deployed', () => {
            const worker = { deployed_on: '2026-08-29T18:04:11.123456Z' };

            assertEqual(true, readWorkerRecord(worker, 'my-worker').deployed);
        });

        it('reads an absent or empty deployed_on as never deployed', () => {
            assertEqual(false, readWorkerRecord({}, 'my-worker').deployed);
            assertEqual(false, readWorkerRecord({ deployed_on: '' }, 'my-worker').deployed);
        });
    });

    describe('provisioned classes', ({ it }) => {
        it('recovers the class name from a prefixed namespace name', () => {
            const worker = makeWorker([
                { namespace_name: 'my-worker_ContentStore', namespace_id: 'ns-1' },
            ]);

            const { provisionedClasses } = readWorkerRecord(worker, 'my-worker');

            assertEqual('ContentStore', provisionedClasses.join(','));
        });

        it('omits a namespace name without the expected prefix', () => {
            const worker = makeWorker([
                { namespace_name: 'other-worker_Counter' },
                { namespace_name: 'ContentStore' },
                { namespace_name: '' },
                {},
                { namespace_name: 'my-worker_' },
            ]);

            assertEqual(0, readWorkerRecord(worker, 'my-worker').provisionedClasses.length);
        });

        it('round trips a class name containing an underscore', () => {
            const worker = makeWorker([ { namespace_name: 'my_worker_Content_Store' } ]);

            const { provisionedClasses } = readWorkerRecord(worker, 'my_worker');

            assertEqual('Content_Store', provisionedClasses.join(','));
        });

        it('reads an absent references block as no provisioned classes', () => {
            assertEqual(0, readWorkerRecord({}, 'my-worker').provisionedClasses.length);
            assertEqual(0, readWorkerRecord({ references: {} }, 'my-worker').provisionedClasses.length);
            assertEqual(0, readWorkerRecord(makeWorker([]), 'my-worker').provisionedClasses.length);
        });

        it('sorts the recovered class names', () => {
            const worker = makeWorker([
                { namespace_name: 'my-worker_Zebra' },
                { namespace_name: 'my-worker_Aardvark' },
            ]);

            assertEqual(
                'Aardvark,Zebra',
                readWorkerRecord(worker, 'my-worker').provisionedClasses.join(','),
            );
        });
    });
});


function makeWorker(durableObjects) {
    return {
        id: 'worker-id',
        name: 'my-worker',
        deployed_on: '2026-08-29T18:04:11.123456Z',
        references: { durable_objects: durableObjects },
    };
}
