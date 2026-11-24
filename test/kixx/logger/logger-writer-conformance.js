import {
    assert,
    assertEqual,
    assertMatches,
    assertNotMatches,
    assertUndefined,
} from '../../../kixx/assertions/mod.js';


/**
 * @typedef {import('../../../kixx/logger/logger-writer-interface.js').LoggerWriterInterface} LoggerWriterInterface
 */

/**
 * @typedef {Object} LoggerWriterSubject
 * @property {LoggerWriterInterface} writer - The adapter under test, built
 *   over a sink the factory can read back. On a running server that sink is
 *   never the real console or a process stream, which carry the server's own
 *   logs.
 * @property {function(): string[]} lines - Returns every line written so far,
 *   in call order: one string per `write()`, without the trailing newline.
 */

/**
 * @callback MakeLoggerWriter
 * @returns {LoggerWriterSubject}
 */

const LEVELS = [
    [ 'DEBUG', 10 ],
    [ 'INFO', 20 ],
    [ 'WARN', 30 ],
    [ 'ERROR', 40 ],
];

/**
 * The shared logger writer contract suite, run against every adapter.
 *
 * It covers what every adapter writes: one line of JSON per entry, the fields
 * of that entry, and inputs left as the caller passed them. Where a line goes
 * (which console method, stdout or stderr) and how it is terminated belong in
 * the adapter's own test file.
 *
 * This suite also runs on real platforms, inside a running server. Before you
 * change it, read the rules for such suites in `test/README.md`, under "Shared
 * Conformance Suites".
 *
 * @param {Function} describe - Nested `describe` handle from the enclosing block.
 * @param {MakeLoggerWriter} makeLoggerWriter - Builds the adapter under test. Called once per test.
 */
export default function loggerWriterConformance(describe, makeLoggerWriter) {

    describe('contract: one JSON line per write', ({ it }) => {
        for (const [ level, levelCode ] of LEVELS) {
            it(`writes one line of JSON for a ${ level } entry`, () => {
                const { writer, lines } = makeLoggerWriter();

                writer.write('App:Request', levelCode, level, 'something happened');

                assertEqual(1, lines().length);
                assertNotMatches('\n', lines()[0]);

                const entry = JSON.parse(lines()[0]);
                assertEqual(levelCode, entry.levelCode);
                assertEqual(level.toLowerCase(), entry.level);
                assertUndefined(entry.levelName);
                assertEqual('App:Request', entry.name);
                assertEqual('something happened', entry.message);
            });
        }

        it('writes one line per call, in call order', () => {
            const { writer, lines } = makeLoggerWriter();

            writer.write('App', 20, 'INFO', 'first');
            writer.write('App', 40, 'ERROR', 'second');
            writer.write('App', 10, 'DEBUG', 'third');

            const messages = lines().map((line) => JSON.parse(line).message);
            assertEqual('first,second,third', messages.join(','));
        });

        it('stamps the entry with the current time as an ISO 8601 string', () => {
            const { writer, lines } = makeLoggerWriter();

            const before = Date.now();
            writer.write('App', 20, 'INFO', 'timed');
            const after = Date.now();

            const { timestamp } = JSON.parse(lines()[0]);
            const time = new Date(timestamp).getTime();
            assertMatches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, timestamp);
            assert(time >= before && time <= after, 'expected the timestamp to fall within the write() call');
        });
    });

    describe('contract: info', ({ it }) => {
        it('passes info through', () => {
            const { writer, lines } = makeLoggerWriter();
            const info = { requestId: 'abc', count: 2, tags: [ 'a', 'b' ], nested: { ok: true } };

            writer.write('App', 20, 'INFO', 'with info', info);

            assertEqual(JSON.stringify(info), JSON.stringify(JSON.parse(lines()[0]).info));
        });

        it('leaves info and error out when they are absent or undefined', () => {
            const { writer, lines } = makeLoggerWriter();

            writer.write('App', 20, 'INFO', 'absent');
            writer.write('App', 20, 'INFO', 'undefined', undefined, undefined);

            for (const line of lines()) {
                const entry = JSON.parse(line);
                assertUndefined(entry.info);
                assertUndefined(entry.error);
            }
            assertEqual(2, lines().length);
        });

        it('does not throw when info contains a circular reference', () => {
            const { writer, lines } = makeLoggerWriter();
            const info = { requestId: 'abc' };
            info.self = info;

            writer.write('App', 20, 'INFO', 'with circular info', info);

            const entry = JSON.parse(lines()[0]);
            assertEqual('abc', entry.info.requestId);
            assertEqual('[CIRCULAR_REFERENCE]', entry.info.self);
        });

        it('serializes primitive and boxed BigInt values as strings', () => {
            const { writer, lines } = makeLoggerWriter();

            writer.write('App', 20, 'INFO', 'with bigint info', {
                count: 10n,
                boxed: Object(12n),
                values: [ 3n ],
            });

            const entry = JSON.parse(lines()[0]);
            assertEqual('10', entry.info.count);
            assertEqual('12', entry.info.boxed);
            assertEqual('3', entry.info.values[0]);
        });

        it('does not treat repeated non-circular references as circular', () => {
            const { writer, lines } = makeLoggerWriter();
            const shared = { value: 'shared' };

            writer.write('App', 20, 'INFO', 'with shared info', {
                count: 1n,
                first: shared,
                second: shared,
            });

            const entry = JSON.parse(lines()[0]);
            assertEqual('shared', entry.info.first.value);
            assertEqual('shared', entry.info.second.value);
        });

        it('does not throw when info has a throwing toJSON method', () => {
            const { writer, lines } = makeLoggerWriter();

            writer.write('App', 20, 'INFO', 'with hostile info', {
                ok: true,
                toJSON() {
                    throw new Error('bad toJSON');
                },
            });

            const entry = JSON.parse(lines()[0]);
            assertEqual(true, entry.info.ok);
            assertUndefined(entry.info.toJSON);
        });
    });

    describe('contract: error', ({ it }) => {
        it('serializes Error details including cause and enumerable properties', () => {
            const { writer, lines } = makeLoggerWriter();
            const cause = new Error('database unavailable');
            cause.code = 'DB_OFFLINE';

            const error = new Error('request failed', { cause });
            error.code = 'REQUEST_FAILED';
            error.type = 'operational';

            writer.write('App', 40, 'ERROR', 'failed', undefined, error);

            const entry = JSON.parse(lines()[0]);
            assertEqual('Error', entry.error.name);
            assertEqual('REQUEST_FAILED', entry.error.code);
            assertEqual('request failed', entry.error.message);
            assertEqual('operational', entry.error.type);
            assertMatches('Error: request failed', entry.error.stack);

            assertEqual('Error', entry.error.cause.name);
            assertEqual('DB_OFFLINE', entry.error.cause.code);
            assertEqual('database unavailable', entry.error.cause.message);
            assertMatches('Error: database unavailable', entry.error.cause.stack);
        });

        it('does not throw when an Error has a circular enumerable Error property', () => {
            const { writer, lines } = makeLoggerWriter();
            const error = new Error('self-referencing error');
            error.self = error;

            writer.write('App', 40, 'ERROR', 'with error cycle', undefined, error);

            const entry = JSON.parse(lines()[0]);
            assertEqual('self-referencing error', entry.error.message);
            assertEqual('[CIRCULAR_ERROR_CAUSE]', entry.error.self);
        });
    });

    // Writing to a frozen object throws in module code, so a writer that
    // mutated its input would fail these on the write() call itself.
    describe('contract: inputs are not mutated', ({ it }) => {
        it('does not mutate info', () => {
            const { writer, lines } = makeLoggerWriter();
            const plain = Object.freeze({ requestId: 'abc', tags: Object.freeze([ 'a', 'b' ]) });
            // A BigInt can't go through JSON.stringify, which sends this one
            // down the writer's other serialization path.
            const withBigInt = Object.freeze({ requestId: 'def', nested: Object.freeze({ count: 10n }) });

            writer.write('App', 20, 'INFO', 'frozen info', plain);
            writer.write('App', 20, 'INFO', 'frozen info', withBigInt);

            assertEqual('abc', JSON.parse(lines()[0]).info.requestId);
            assertEqual('10', JSON.parse(lines()[1]).info.nested.count);
            assertEqual('requestId,tags', Object.keys(plain).join(','));
            assertEqual('requestId,nested', Object.keys(withBigInt).join(','));
        });

        it('does not mutate error', () => {
            const { writer, lines } = makeLoggerWriter();
            const cause = Object.freeze(new Error('database unavailable'));
            const error = new Error('request failed', { cause });
            error.code = 'REQUEST_FAILED';
            Object.freeze(error);

            writer.write('App', 40, 'ERROR', 'frozen error', undefined, error);

            const entry = JSON.parse(lines()[0]);
            assertEqual('request failed', entry.error.message);
            assertEqual('database unavailable', entry.error.cause.message);
            assertEqual('REQUEST_FAILED', error.code);
            assertEqual(cause, error.cause);
        });
    });
}
