import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import { resolveEnqueue } from '../../../../src/kixx/jobs/enqueue-options.js';
import { validateJobRegistry } from '../../../../src/kixx/jobs/job-registry.js';


const NOW = new Date(Date.UTC(2026, 2, 10));
const registry = validateJobRegistry(new Map([
    [ 'one', { name: 'one', description: 'One.', handler: async () => {} } ],
]));

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('resolveEnqueue()', ({ it }) => {
    it('defaults to now', () => {
        const result = resolveEnqueue(registry, 'one', undefined, NOW);

        assertEqual(NOW.getTime(), result.runAt.getTime());
        assertEqual('one', result.entry.name);
    });

    it('resolves delaySeconds and runAt', () => {
        assertEqual(NOW.getTime() + 5000, resolveEnqueue(registry, 'one', { delaySeconds: 5 }, NOW).runAt.getTime());
        assertEqual(
            Date.UTC(2026, 9, 1, 9),
            resolveEnqueue(registry, 'one', { runAt: '2026-10-01T09:00:00Z', key: 'k' }, NOW).runAt.getTime(),
        );
    });

    it('rejects unknown names and bad options', () => {
        assertEqual('AssertionError', catchError(() => resolveEnqueue(registry, 'nope', {}, NOW)).name);
        assertEqual('AssertionError', catchError(() => resolveEnqueue(registry, 'one', { runAt: 'x' }, NOW)).name);
        assertEqual('AssertionError', catchError(() => resolveEnqueue(registry, 'one', { delaySeconds: -1 }, NOW)).name);
        assertEqual('AssertionError', catchError(() => resolveEnqueue(
            registry, 'one', { runAt: NOW, delaySeconds: 1 }, NOW,
        )).name);
    });
});
