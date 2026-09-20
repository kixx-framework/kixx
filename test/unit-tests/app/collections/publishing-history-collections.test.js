import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import ActivationCollection, {
    ACTIVATION_BUILD_INDEX,
} from '../../../../src/app/collections/activation-collection.js';
import ReleaseCollection from '../../../../src/app/collections/release-collection.js';


const ASSIGNMENT_ID = '11111111-1111-4111-8111-111111111111';


function makeDb() {
    const calls = [];
    return {
        calls,
        async put(_context, doc) {
            calls.push({ method: 'put', type: doc.type, doc });
            return {
                type: doc.type,
                id: doc.id,
                sortKey: doc.sortKey ?? null,
                version: 1,
                createdAt: doc.activatedAt,
                updatedAt: doc.activatedAt,
                doc,
            };
        },
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

    it('appends one Activation per assignment, however many times it is called', async () => {
        const db = makeDb();
        const activations = new ActivationCollection({ db });
        const attributes = {
            buildId: 'build-1',
            assignmentId: ASSIGNMENT_ID,
            fromReleaseId: 'release-old',
            toReleaseId: 'release-new',
            activatedAt: '2026-09-01T12:00:00.000Z',
            activatedBy: 'token-1',
            reason: 'publish',
        };

        // A retried append must overwrite its own row rather than add a second one.
        await activations.append({}, attributes);
        await activations.append({}, attributes);

        assertEqual(2, db.calls.length);
        assertEqual('put', db.calls[0].method);
        assertEqual('put', db.calls[1].method);
        assertEqual(`build-1:${ ASSIGNMENT_ID }`, db.calls[0].doc.id);
        assertEqual(db.calls[0].doc.id, db.calls[1].doc.id);
        assertEqual('2026-09-01T12:00:00.000Z', db.calls[0].doc.sortKey);
        assertEqual('build-1:2026-09-01T12:00:00.000Z', db.calls[0].doc.buildActivationKey);
    });

    it('rejects an append which cannot derive a stable Activation id', async () => {
        const db = makeDb();
        const activations = new ActivationCollection({ db });
        let error;

        try {
            await activations.append({}, {
                buildId: 'build-1',
                fromReleaseId: null,
                toReleaseId: 'release-new',
                activatedAt: '2026-09-01T12:00:00.000Z',
                activatedBy: 'token-1',
                reason: 'publish',
            });
        } catch (cause) {
            error = cause;
        }

        assert(error);
        assertEqual('ValidationError', error.name);
        assertEqual('assignmentId', error.errors[0].source);
        assertEqual(0, db.calls.length);
    });
});
