import { describe, MockTracker } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertMatches,
    assertUndefined,
} from 'kixx-assert';

import Logger from '../../../src/kixx/logger/logger.js';


// A writer test double records each write() call so tests can assert on the
// exact arguments the Logger forwards to a pluggable output adapter.
function makeWriter(tracker) {
    return { write: tracker.fn() };
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('Logger', ({ describe }) => {

    describe('Logger.LEVELS', ({ it }) => {
        it('exposes the integer level constants including NONE', () => {
            assertEqual(10, Logger.LEVELS.DEBUG);
            assertEqual(20, Logger.LEVELS.INFO);
            assertEqual(30, Logger.LEVELS.WARN);
            assertEqual(40, Logger.LEVELS.ERROR);
            assertEqual(100, Logger.LEVELS.NONE);
        });
    });

    describe('Logger.getLevelNameFromInteger', ({ it }) => {
        it('returns the level name for a known integer', () => {
            assertEqual('DEBUG', Logger.getLevelNameFromInteger(10));
            assertEqual('INFO', Logger.getLevelNameFromInteger(20));
            assertEqual('WARN', Logger.getLevelNameFromInteger(30));
            assertEqual('ERROR', Logger.getLevelNameFromInteger(40));
            assertEqual('NONE', Logger.getLevelNameFromInteger(100));
        });

        it('returns undefined for an unknown integer', () => {
            assertUndefined(Logger.getLevelNameFromInteger(99));
        });
    });

    describe('Logger constructor', ({ it }) => {
        it('assigns the provided name as a read-only property', () => {
            const logger = new Logger({ name: 'App' });

            assertEqual('App', logger.name);

            const caught = catchError(() => {
                logger.name = 'Other';
            });

            assert(caught, 'expected reassigning name to throw');
            assertEqual('TypeError', caught.name);
            assertEqual('App', logger.name);
        });

        it('defaults the level to INFO when omitted', () => {
            const logger = new Logger({ name: 'App' });

            assertEqual('INFO', logger.level);
        });

        it('accepts an initial level as a name', () => {
            const logger = new Logger({ name: 'App', level: 'WARN' });

            assertEqual('WARN', logger.level);
        });

        it('accepts an initial level as an integer', () => {
            const logger = new Logger({ name: 'App', level: Logger.LEVELS.DEBUG });

            assertEqual('DEBUG', logger.level);
        });

        it('throws an AssertionError when name is missing', () => {
            const caught = catchError(() => new Logger({}));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError when name is an empty string', () => {
            const caught = catchError(() => new Logger({ name: '' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError when writer.write is not a function', () => {
            const caught = catchError(() => new Logger({ name: 'App', writer: { write: 5 } }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError when level is an invalid name', () => {
            const caught = catchError(() => new Logger({ name: 'App', level: 'NOPE' }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError when level is an invalid integer', () => {
            const caught = catchError(() => new Logger({ name: 'App', level: 99 }));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('Logger#level', ({ it }) => {
        it('accepts a lowercase level name and normalizes it', () => {
            const logger = new Logger({ name: 'App' });

            logger.level = 'debug';

            assertEqual('DEBUG', logger.level);
        });

        it('accepts an integer level value', () => {
            const logger = new Logger({ name: 'App' });

            logger.level = Logger.LEVELS.ERROR;

            assertEqual('ERROR', logger.level);
        });

        it('accepts NONE to disable all output', () => {
            const logger = new Logger({ name: 'App' });

            logger.level = 'NONE';

            assertEqual('NONE', logger.level);
        });

        it('throws an AssertionError for an unknown name', () => {
            const logger = new Logger({ name: 'App' });

            const caught = catchError(() => {
                logger.level = 'LOUD';
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an AssertionError for a non-level value', () => {
            const logger = new Logger({ name: 'App' });

            const caught = catchError(() => {
                logger.level = 1.5;
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });
    });

    describe('Logger level filtering', ({ it }) => {
        it('suppresses entries below the threshold at the default INFO level', () => {
            const tracker = new MockTracker();
            const writer = makeWriter(tracker);
            const logger = new Logger({ name: 'App', writer });

            logger.debug('debug');
            logger.info('info');
            logger.warn('warn');
            logger.error('error');

            assertEqual(3, writer.write.mock.callCount());
        });

        it('accepts every level when set to DEBUG', () => {
            const tracker = new MockTracker();
            const writer = makeWriter(tracker);
            const logger = new Logger({ name: 'App', level: 'DEBUG', writer });

            logger.debug('debug');
            logger.info('info');
            logger.warn('warn');
            logger.error('error');

            assertEqual(4, writer.write.mock.callCount());
        });

        it('accepts only ERROR when set to ERROR', () => {
            const tracker = new MockTracker();
            const writer = makeWriter(tracker);
            const logger = new Logger({ name: 'App', level: 'ERROR', writer });

            logger.debug('debug');
            logger.info('info');
            logger.warn('warn');
            logger.error('error');

            assertEqual(1, writer.write.mock.callCount());
            assertEqual(Logger.LEVELS.ERROR, writer.write.mock.getCall(0).arguments[1]);
        });

        it('suppresses every entry when set to NONE', () => {
            const tracker = new MockTracker();
            const writer = makeWriter(tracker);
            const logger = new Logger({ name: 'App', level: 'NONE', writer });

            logger.debug('debug');
            logger.info('info');
            logger.warn('warn');
            logger.error('error');

            assertEqual(0, writer.write.mock.callCount());
        });
    });

    describe('Logger writer arguments', ({ it }) => {
        it('forwards name, level integer, level name, message, info, and error to the writer', () => {
            const tracker = new MockTracker();
            const writer = makeWriter(tracker);
            const logger = new Logger({ name: 'App', writer });
            const info = { requestId: 'abc' };
            const error = new Error('boom');

            logger.warn('something happened', info, error);

            const call = writer.write.mock.getCall(0);
            assertEqual('App', call.arguments[0]);
            assertEqual(Logger.LEVELS.WARN, call.arguments[1]);
            assertEqual('WARN', call.arguments[2]);
            assertEqual('something happened', call.arguments[3]);
            assertEqual(info, call.arguments[4]);
            assertEqual(error, call.arguments[5]);
        });

        it('passes undefined for info and error when the caller omits them', () => {
            const tracker = new MockTracker();
            const writer = makeWriter(tracker);
            const logger = new Logger({ name: 'App', writer });

            logger.info('plain message');

            const call = writer.write.mock.getCall(0);
            assertUndefined(call.arguments[4]);
            assertUndefined(call.arguments[5]);
        });
    });

    describe('Logger built-in console output', ({ it }) => {
        it('routes an INFO entry to console.info with a formatted message', () => {
            const tracker = new MockTracker();
            const infoMock = tracker.method(console, 'info', () => {});
            const logger = new Logger({ name: 'App' });

            logger.info('hello world');

            assertEqual(1, infoMock.mock.callCount());
            const message = infoMock.mock.getCall(0).arguments[0];
            assertMatches('INFO', message);
            assertMatches('App', message);
            assertMatches('hello world', message);

            tracker.reset();
        });

        it('passes the info argument as a second console argument', () => {
            const tracker = new MockTracker();
            const infoMock = tracker.method(console, 'info', () => {});
            const logger = new Logger({ name: 'App' });
            const info = { id: 7 };

            logger.info('with info', info);

            assertEqual(info, infoMock.mock.getCall(0).arguments[1]);

            tracker.reset();
        });

        it('logs the error object through console.error in addition to the message', () => {
            const tracker = new MockTracker();
            const errorMock = tracker.method(console, 'error', () => {});
            const logger = new Logger({ name: 'App' });
            const error = new Error('boom');

            logger.error('failed', undefined, error);

            assertEqual(2, errorMock.mock.callCount());
            assertMatches('failed', errorMock.mock.getCall(0).arguments[0]);
            assertEqual(error, errorMock.mock.getCall(1).arguments[0]);

            tracker.reset();
        });
    });

    describe('Logger#createChild', ({ it }) => {
        it('creates a namespaced child that inherits writer and level', () => {
            const tracker = new MockTracker();
            const writer = makeWriter(tracker);
            const logger = new Logger({ name: 'App', level: 'WARN', writer });

            const child = logger.createChild('RequestHandler');

            assertEqual('App:RequestHandler', child.name);
            assertEqual('WARN', child.level);

            child.warn('child message');
            assertEqual('App:RequestHandler', writer.write.mock.getCall(0).arguments[0]);
        });

        it('cascades a parent level change to existing children', () => {
            const logger = new Logger({ name: 'App' });
            const child = logger.createChild('Child');

            assertEqual('INFO', child.level);

            logger.level = 'DEBUG';

            assertEqual('DEBUG', child.level);
        });

        it('preserves the concrete subclass type for children', () => {
            class CustomLogger extends Logger {}

            const logger = new CustomLogger({ name: 'App' });
            const child = logger.createChild('Child');

            assert(child instanceof CustomLogger, 'expected child to be a CustomLogger');
        });

        it('throws an AssertionError when name is empty', () => {
            const logger = new Logger({ name: 'App' });

            const caught = catchError(() => logger.createChild(''));

            assert(caught, 'expected an error to be thrown');
            assertEqual('AssertionError', caught.name);
        });

        it('throws an Error when the logger is finalized', () => {
            const logger = new Logger({ name: 'App' });
            logger.finalize();

            const caught = catchError(() => logger.createChild('Child'));

            assert(caught, 'expected an error to be thrown');
            assertEqual('Error', caught.name);
            assertMatches('finalized', caught.message);
        });
    });

    describe('Logger#finalize', ({ it }) => {
        it('returns this', () => {
            const logger = new Logger({ name: 'App' });

            assertEqual(logger, logger.finalize());
        });

        it('cascades finalization to existing children', () => {
            const logger = new Logger({ name: 'App' });
            const child = logger.createChild('Child');

            logger.finalize();

            const caught = catchError(() => child.createChild('GrandChild'));

            assert(caught, 'expected an error to be thrown');
            assertMatches('finalized', caught.message);
        });
    });
});
