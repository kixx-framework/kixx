import { describe, MockTracker } from 'kixx-test';
import {
    assertEqual,
    assertMatches,
    assertUndefined,
} from 'kixx-assert';

import {
    createJSONLogEntry,
    stringifyJSONLogEntry,
} from '../../../src/kixx/logger/json-log-entry-serializer.js';


describe('JsonLogEntrySerializer', ({ describe }) => {

    describe('createJSONLogEntry', ({ it }) => {
        it('creates an entry with the required log fields', () => {
            const entry = createJSONLogEntry({
                name: 'App',
                level: 20,
                levelName: 'INFO',
                message: 'request completed',
            });

            assertEqual('INFO', entry.levelName);
            assertEqual(20, entry.level);
            assertEqual('App', entry.name);
            assertEqual('request completed', entry.message);
        });

        it('preserves the timestamp', () => {
            const timestamp = '2026-07-13T10:04:06.123Z';

            const entry = createJSONLogEntry({
                timestamp,
                name: 'App',
                level: 20,
                levelName: 'INFO',
                message: 'request completed',
            });

            assertEqual(timestamp, entry.timestamp);
        });

        it('omits optional info and error fields when they are undefined', () => {
            const entry = createJSONLogEntry({
                name: 'App',
                level: 20,
                levelName: 'INFO',
                message: 'request completed',
            });

            assertUndefined(entry.info);
            assertUndefined(entry.error);
        });

        it('preserves supplementary info', () => {
            const info = { requestId: 'abc' };

            const entry = createJSONLogEntry({
                name: 'App',
                level: 20,
                levelName: 'INFO',
                message: 'request completed',
                info,
            });

            assertEqual(info, entry.info);
        });

        it('serializes Error details, causes, and enumerable properties', () => {
            const cause = new Error('database unavailable');
            cause.code = 'DB_OFFLINE';

            const error = new Error('request failed', { cause });
            error.code = 'REQUEST_FAILED';
            error.type = 'operational';

            const entry = createJSONLogEntry({
                name: 'App',
                level: 40,
                levelName: 'ERROR',
                message: 'request failed',
                error,
            });

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

        it('marks circular Error relationships without recursing indefinitely', () => {
            const error = new Error('self-referencing error');
            error.self = error;

            const entry = createJSONLogEntry({
                name: 'App',
                level: 40,
                levelName: 'ERROR',
                message: 'request failed',
                error,
            });

            assertEqual('[CIRCULAR_ERROR_CAUSE]', entry.error.self);
        });
    });

    describe('stringifyJSONLogEntry', ({ it }) => {
        it('uses native JSON serialization for a JSON-safe entry', () => {
            const entry = {
                levelName: 'INFO',
                level: 20,
                name: 'App',
                message: 'request completed',
                info: { requestId: 'abc' },
            };

            assertEqual(JSON.stringify(entry), stringifyJSONLogEntry(entry));
        });

        it('makes BigInt values and circular references JSON safe', () => {
            const shared = { state: 'ready' };
            const info = {
                count: 10n,
                boxedCount: Object(12n),
                first: shared,
                second: shared,
            };
            info.self = info;

            const json = stringifyJSONLogEntry({ info });
            const entry = JSON.parse(json);

            assertEqual('10', entry.info.count);
            assertEqual('12', entry.info.boxedCount);
            assertEqual('ready', entry.info.first.state);
            assertEqual('ready', entry.info.second.state);
            assertEqual('[CIRCULAR_REFERENCE]', entry.info.self);
        });

        it('omits functions when a throwing toJSON method triggers safe serialization', () => {
            const json = stringifyJSONLogEntry({
                info: {
                    ok: true,
                    toJSON() {
                        throw new Error('bad toJSON');
                    },
                },
            });
            const entry = JSON.parse(json);

            assertEqual(true, entry.info.ok);
            assertUndefined(entry.info.toJSON);
        });

        it('describes properties that throw while being read', () => {
            const info = { ok: true, count: 1n };
            Object.defineProperty(info, 'hostile', {
                enumerable: true,
                get() {
                    throw new Error('getter failed');
                },
            });

            const json = stringifyJSONLogEntry({ info });
            const entry = JSON.parse(json);

            assertEqual(true, entry.info.ok);
            assertMatches('[UNSERIALIZABLE_VALUE]', entry.info.hostile);
            assertMatches('getter failed', entry.info.hostile);
        });

        it('emits a minimal entry when native and safe serialization both fail', () => {
            const tracker = new MockTracker();
            const nativeStringify = JSON.stringify;
            let stringifyCallCount = 0;

            tracker.method(JSON, 'stringify', (...args) => {
                stringifyCallCount += 1;

                if (stringifyCallCount < 3) {
                    throw new Error('forced serialization failure');
                }

                return nativeStringify(...args);
            });

            let json;

            try {
                json = stringifyJSONLogEntry({
                    timestamp: '2026-07-13T10:04:06.123Z',
                    levelName: 'INFO',
                    level: 20,
                    name: 'App',
                    message: 'request completed',
                    info: { requestId: 'abc' },
                });
            } finally {
                tracker.reset();
            }

            const entry = JSON.parse(json);
            assertEqual('2026-07-13T10:04:06.123Z', entry.timestamp);
            assertEqual('INFO', entry.levelName);
            assertEqual(20, entry.level);
            assertEqual('App', entry.name);
            assertEqual('request completed', entry.message);
            assertEqual('[UNSERIALIZABLE_LOG_ENTRY]', entry.info);
            assertMatches('forced serialization failure', entry.nativeSerializationError);
            assertMatches('forced serialization failure', entry.fallbackSerializationError);
        });
    });
});
