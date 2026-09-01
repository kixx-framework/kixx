import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import ActivationCollection, {
    ACTIVATION_BUILD_INDEX,
} from '../../../../src/app/collections/activation-collection.js';
import ReleaseCollection from '../../../../src/app/collections/release-collection.js';


function makeDb() {
    const calls = [];
    return {
        calls,
        async scan(_context, type, options) {
            calls.push({ method: 'scan', type, options });
            return { records: [], cursor: null };
        },
        async query(_context, type, options) {
            calls.push({ method: 'query', type, options });
            return { records: [], cursor: null };
        },
    };
}

describe('Publishing history Collections', ({ it }) => {

    it('lists Releases newest first with the supplied cursor', async () => {
        const db = makeDb();
        const releases = new ReleaseCollection({ db });
        await releases.listPage({}, { cursor: 'cursor-1', limit: 20 });

        assertEqual('scan', db.calls[0].method);
        assertEqual('Release', db.calls[0].type);
        assertEqual(true, db.calls[0].options.descending);
        assertEqual('cursor-1', db.calls[0].options.cursor);
        assertEqual(20, db.calls[0].options.limit);
    });

    it('lists one build by its timestamp-bearing index prefix', async () => {
        const db = makeDb();
        const activations = new ActivationCollection({ db });
        await activations.listPage({}, { buildId: 'build-1', cursor: 'cursor-2', limit: 10 });

        assertEqual('query', db.calls[0].method);
        assertEqual('Activation', db.calls[0].type);
        assertEqual(ACTIVATION_BUILD_INDEX, db.calls[0].options.index);
        assertEqual(true, db.calls[0].options.descending);
        assertEqual('build-1:', db.calls[0].options.greaterThanOrEqualTo);
        assertEqual('cursor-2', db.calls[0].options.cursor);
    });
});
