import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import {
    getMigration,
    listMigrations,
    migrations,
} from '../../../src/app/migrations/mod.js';
import { migrate as exampleNoop } from '../../../src/app/migrations/2026-07-17-example-noop.js';


const EXAMPLE_ID = '2026-07-17-example-noop';


describe('migration registry', ({ it }) => {
    it('returns the registered entry and null for an unregistered id', () => {
        const entry = getMigration(EXAMPLE_ID);

        assertEqual(EXAMPLE_ID, entry.id);
        assertEqual(exampleNoop, entry.migrate);
        assertEqual(null, getMigration('2026-07-17-unregistered'));
    });

    it('exports the application registry as a Map', () => {
        assert(migrations instanceof Map);
        assertEqual(EXAMPLE_ID, migrations.keys().next().value);
    });

    it('rejects a key and entry id mismatch before lookup or listing', () => {
        const mismatched = new Map([
            [ EXAMPLE_ID, makeEntry({ id: '2026-07-17-different-id' }) ],
        ]);

        assertAssertionError(() => getMigration(EXAMPLE_ID, mismatched));
        assertAssertionError(() => listMigrations(mismatched));
    });

    it('rejects malformed registry entry contracts', () => {
        assertAssertionError(() => listMigrations(new Map([
            [ 'invalid-id', makeEntry({ id: 'invalid-id' }) ],
        ])));
        assertAssertionError(() => listMigrations(new Map([
            [ EXAMPLE_ID, makeEntry({ description: '' }) ],
        ])));
        assertAssertionError(() => listMigrations(new Map([
            [ EXAMPLE_ID, makeEntry({ migrate: null }) ],
        ])));
    });

    it('lists entries in registry insertion order', () => {
        const first = makeEntry({ id: '2026-07-17-first-migration' });
        const second = makeEntry({ id: '2026-07-18-second-migration' });
        const registry = new Map([
            [ first.id, first ],
            [ second.id, second ],
        ]);
        const entries = listMigrations(registry);

        assertEqual(first, entries[0]);
        assertEqual(second, entries[1]);
        assertEqual(2, entries.length);
    });

    it('runs the no-op example as one terminal batch without context I/O', async () => {
        const context = new Proxy({}, {
            get() {
                throw new Error('The no-op migration must not access context');
            },
        });
        const result = await exampleNoop(context, {
            cursor: 'opaque-caller-cursor',
            dryRun: true,
        });

        assertEqual(true, result.done);
        assertEqual(null, result.cursor);
        assertEqual(0, result.stats.scanned);
    });
});

function makeEntry(overrides) {
    return {
        id: EXAMPLE_ID,
        description: 'Example migration entry.',
        migrate: exampleNoop,
        ...overrides,
    };
}

function assertAssertionError(fn) {
    const caught = catchError(fn);

    assert(caught, 'expected an AssertionError');
    assertEqual('AssertionError', caught.name);
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
