import process from 'node:process';
import { describe, MockTracker } from 'kixx-test';
import {
    assertEqual,
    assertMatches,
    assertUndefined,
} from 'kixx-assert';

import LoggerWriter from '../../../../lib/node/logger/logger-writer.js';


function parseStreamEntry(mock, index = 0) {
    return JSON.parse(mock.mock.getCall(index).arguments[0]);
}

function getStreamLine(mock, index = 0) {
    return mock.mock.getCall(index).arguments[0];
}


describe('Node LoggerWriter', ({ describe }) => {

    describe('write', ({ it }) => {
        it('writes DEBUG and INFO entries to stdout as newline-terminated JSON', () => {
            const tracker = new MockTracker();
            const stdoutMock = tracker.method(process.stdout, 'write', () => true);
            const stderrMock = tracker.method(process.stderr, 'write', () => true);

            try {
                const writer = new LoggerWriter();

                writer.write('App', 10, 'DEBUG', 'debug message');
                writer.write('App', 20, 'INFO', 'info message', { requestId: 'abc' });

                assertEqual(2, stdoutMock.mock.callCount());
                assertEqual(0, stderrMock.mock.callCount());
                assertMatches(/\n$/, getStreamLine(stdoutMock, 0));
                assertMatches(/\n$/, getStreamLine(stdoutMock, 1));

                const debugEntry = parseStreamEntry(stdoutMock, 0);
                assertEqual('DEBUG', debugEntry.levelName);
                assertEqual(10, debugEntry.level);
                assertEqual('debug message', debugEntry.message);
                assertUndefined(debugEntry.info);

                const infoEntry = parseStreamEntry(stdoutMock, 1);
                assertEqual('INFO', infoEntry.levelName);
                assertEqual(20, infoEntry.level);
                assertEqual('App', infoEntry.name);
                assertEqual('info message', infoEntry.message);
                assertEqual('abc', infoEntry.info.requestId);
            } finally {
                tracker.reset();
            }
        });

        it('writes WARN and ERROR entries to stderr as newline-terminated JSON', () => {
            const tracker = new MockTracker();
            const stdoutMock = tracker.method(process.stdout, 'write', () => true);
            const stderrMock = tracker.method(process.stderr, 'write', () => true);

            try {
                const writer = new LoggerWriter();

                writer.write('App', 30, 'WARN', 'warning');
                writer.write('App', 40, 'ERROR', 'failure');

                assertEqual(0, stdoutMock.mock.callCount());
                assertEqual(2, stderrMock.mock.callCount());
                assertMatches(/\n$/, getStreamLine(stderrMock, 0));
                assertMatches(/\n$/, getStreamLine(stderrMock, 1));

                const warnEntry = parseStreamEntry(stderrMock, 0);
                assertEqual('WARN', warnEntry.levelName);
                assertEqual(30, warnEntry.level);
                assertEqual('warning', warnEntry.message);

                const errorEntry = parseStreamEntry(stderrMock, 1);
                assertEqual('ERROR', errorEntry.levelName);
                assertEqual(40, errorEntry.level);
                assertEqual('failure', errorEntry.message);
            } finally {
                tracker.reset();
            }
        });

        it('serializes Error details including cause and enumerable properties', () => {
            const tracker = new MockTracker();
            const stderrMock = tracker.method(process.stderr, 'write', () => true);

            try {
                const cause = new Error('database unavailable');
                cause.code = 'DB_OFFLINE';

                const error = new Error('request failed', { cause });
                error.code = 'REQUEST_FAILED';
                error.type = 'operational';

                const writer = new LoggerWriter();
                writer.write('App', 40, 'ERROR', 'failed', undefined, error);

                const entry = parseStreamEntry(stderrMock);
                assertEqual('Error', entry.error.name);
                assertEqual('REQUEST_FAILED', entry.error.code);
                assertEqual('request failed', entry.error.message);
                assertEqual('operational', entry.error.type);
                assertMatches('Error: request failed', entry.error.stack);

                assertEqual('Error', entry.error.cause.name);
                assertEqual('DB_OFFLINE', entry.error.cause.code);
                assertEqual('database unavailable', entry.error.cause.message);
                assertMatches('Error: database unavailable', entry.error.cause.stack);
            } finally {
                tracker.reset();
            }
        });

        it('does not throw when info contains a circular reference', () => {
            const tracker = new MockTracker();
            const stdoutMock = tracker.method(process.stdout, 'write', () => true);

            try {
                const info = { requestId: 'abc' };
                info.self = info;

                const writer = new LoggerWriter();
                writer.write('App', 20, 'INFO', 'with circular info', info);

                const entry = parseStreamEntry(stdoutMock);
                assertEqual('abc', entry.info.requestId);
                assertEqual('[CIRCULAR_REFERENCE]', entry.info.self);
            } finally {
                tracker.reset();
            }
        });

        it('serializes primitive and boxed BigInt values as strings', () => {
            const tracker = new MockTracker();
            const stdoutMock = tracker.method(process.stdout, 'write', () => true);

            try {
                const writer = new LoggerWriter();
                writer.write('App', 20, 'INFO', 'with bigint info', {
                    count: 10n,
                    boxed: Object(12n),
                    values: [ 3n ],
                });

                const entry = parseStreamEntry(stdoutMock);
                assertEqual('10', entry.info.count);
                assertEqual('12', entry.info.boxed);
                assertEqual('3', entry.info.values[0]);
            } finally {
                tracker.reset();
            }
        });

        it('does not treat repeated non-circular references as circular', () => {
            const tracker = new MockTracker();
            const stdoutMock = tracker.method(process.stdout, 'write', () => true);

            try {
                const shared = { value: 'shared' };
                const writer = new LoggerWriter();

                writer.write('App', 20, 'INFO', 'with shared info', {
                    count: 1n,
                    first: shared,
                    second: shared,
                });

                const entry = parseStreamEntry(stdoutMock);
                assertEqual('shared', entry.info.first.value);
                assertEqual('shared', entry.info.second.value);
            } finally {
                tracker.reset();
            }
        });

        it('does not throw when info has a throwing toJSON method', () => {
            const tracker = new MockTracker();
            const stdoutMock = tracker.method(process.stdout, 'write', () => true);

            try {
                const writer = new LoggerWriter();
                writer.write('App', 20, 'INFO', 'with hostile info', {
                    ok: true,
                    toJSON() {
                        throw new Error('bad toJSON');
                    },
                });

                const entry = parseStreamEntry(stdoutMock);
                assertEqual(true, entry.info.ok);
                assertUndefined(entry.info.toJSON);
            } finally {
                tracker.reset();
            }
        });

        it('does not throw when an Error has a circular enumerable Error property', () => {
            const tracker = new MockTracker();
            const stderrMock = tracker.method(process.stderr, 'write', () => true);

            try {
                const error = new Error('self-referencing error');
                error.self = error;

                const writer = new LoggerWriter();
                writer.write('App', 40, 'ERROR', 'with error cycle', undefined, error);

                const entry = parseStreamEntry(stderrMock);
                assertEqual('self-referencing error', entry.error.message);
                assertEqual('[CIRCULAR_ERROR_CAUSE]', entry.error.self);
            } finally {
                tracker.reset();
            }
        });

        it('emits a minimal JSON entry when native and safe serialization both fail', () => {
            const tracker = new MockTracker();
            const stdoutMock = tracker.method(process.stdout, 'write', () => true);
            const stringify = JSON.stringify;
            let stringifyCallCount = 0;

            tracker.method(JSON, 'stringify', (...args) => {
                stringifyCallCount += 1;

                if (stringifyCallCount < 3) {
                    throw new Error('forced serialization failure');
                }

                return stringify(...args);
            });

            try {
                const writer = new LoggerWriter();
                writer.write('App', 20, 'INFO', 'with forced fallback', { id: 7 });

                const entry = parseStreamEntry(stdoutMock);
                assertEqual('INFO', entry.levelName);
                assertEqual(20, entry.level);
                assertEqual('App', entry.name);
                assertEqual('with forced fallback', entry.message);
                assertEqual('[UNSERIALIZABLE_LOG_ENTRY]', entry.info);
                assertMatches('forced serialization failure', entry.nativeSerializationError);
                assertMatches('forced serialization failure', entry.fallbackSerializationError);
            } finally {
                tracker.reset();
            }
        });
    });
});
