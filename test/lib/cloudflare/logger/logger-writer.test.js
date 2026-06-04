import { describe, MockTracker } from 'kixx-test';
import {
    assertEqual,
    assertMatches,
    assertUndefined,
} from 'kixx-assert';

import LoggerWriter from '../../../../lib/cloudflare/logger/logger-writer.js';


function parseConsoleEntry(mock, index = 0) {
    return JSON.parse(mock.mock.getCall(index).arguments[0]);
}


describe('Cloudflare LoggerWriter', ({ describe }) => {

    describe('write', ({ it }) => {
        it('writes a structured JSON entry to the matching console method', () => {
            const tracker = new MockTracker();
            const warnMock = tracker.method(console, 'warn', () => {});

            try {
                const writer = new LoggerWriter();

                writer.write('App', 30, 'WARN', 'heads up', { requestId: 'abc' });

                assertEqual(1, warnMock.mock.callCount());

                const entry = parseConsoleEntry(warnMock);
                assertEqual('WARN', entry.levelName);
                assertEqual(30, entry.level);
                assertEqual('App', entry.name);
                assertEqual('heads up', entry.message);
                assertEqual('abc', entry.info.requestId);
                assertUndefined(entry.error);
            } finally {
                tracker.reset();
            }
        });

        it('serializes Error details including cause and enumerable properties', () => {
            const tracker = new MockTracker();
            const errorMock = tracker.method(console, 'error', () => {});

            try {
                const cause = new Error('database unavailable');
                cause.code = 'DB_OFFLINE';

                const error = new Error('request failed', { cause });
                error.code = 'REQUEST_FAILED';
                error.type = 'operational';

                const writer = new LoggerWriter();
                writer.write('App', 40, 'ERROR', 'failed', undefined, error);

                const entry = parseConsoleEntry(errorMock);
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
            const infoMock = tracker.method(console, 'info', () => {});

            try {
                const info = { requestId: 'abc' };
                info.self = info;

                const writer = new LoggerWriter();
                writer.write('App', 20, 'INFO', 'with circular info', info);

                const entry = parseConsoleEntry(infoMock);
                assertEqual('abc', entry.info.requestId);
                assertEqual('[CIRCULAR_REFERENCE]', entry.info.self);
            } finally {
                tracker.reset();
            }
        });

        it('serializes primitive and boxed BigInt values as strings', () => {
            const tracker = new MockTracker();
            const infoMock = tracker.method(console, 'info', () => {});

            try {
                const writer = new LoggerWriter();
                writer.write('App', 20, 'INFO', 'with bigint info', {
                    count: 10n,
                    boxed: Object(12n),
                    values: [ 3n ],
                });

                const entry = parseConsoleEntry(infoMock);
                assertEqual('10', entry.info.count);
                assertEqual('12', entry.info.boxed);
                assertEqual('3', entry.info.values[0]);
            } finally {
                tracker.reset();
            }
        });

        it('does not treat repeated non-circular references as circular', () => {
            const tracker = new MockTracker();
            const infoMock = tracker.method(console, 'info', () => {});

            try {
                const shared = { value: 'shared' };
                const writer = new LoggerWriter();

                writer.write('App', 20, 'INFO', 'with shared info', {
                    count: 1n,
                    first: shared,
                    second: shared,
                });

                const entry = parseConsoleEntry(infoMock);
                assertEqual('shared', entry.info.first.value);
                assertEqual('shared', entry.info.second.value);
            } finally {
                tracker.reset();
            }
        });

        it('does not throw when info has a throwing toJSON method', () => {
            const tracker = new MockTracker();
            const infoMock = tracker.method(console, 'info', () => {});

            try {
                const writer = new LoggerWriter();
                writer.write('App', 20, 'INFO', 'with hostile info', {
                    ok: true,
                    toJSON() {
                        throw new Error('bad toJSON');
                    },
                });

                const entry = parseConsoleEntry(infoMock);
                assertEqual(true, entry.info.ok);
                assertUndefined(entry.info.toJSON);
            } finally {
                tracker.reset();
            }
        });

        it('does not throw when an Error has a circular enumerable Error property', () => {
            const tracker = new MockTracker();
            const errorMock = tracker.method(console, 'error', () => {});

            try {
                const error = new Error('self-referencing error');
                error.self = error;

                const writer = new LoggerWriter();
                writer.write('App', 40, 'ERROR', 'with error cycle', undefined, error);

                const entry = parseConsoleEntry(errorMock);
                assertEqual('self-referencing error', entry.error.message);
                assertEqual('[CIRCULAR_ERROR_CAUSE]', entry.error.self);
            } finally {
                tracker.reset();
            }
        });

        it('emits a minimal JSON entry when native and safe serialization both fail', () => {
            const tracker = new MockTracker();
            const infoMock = tracker.method(console, 'info', () => {});
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

                const entry = parseConsoleEntry(infoMock);
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
