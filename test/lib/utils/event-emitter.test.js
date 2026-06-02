import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import EventEmitter from '../../../lib/utils/event-emitter.js';


describe('EventEmitter', ({ describe }) => {

    describe('EventEmitter#on', ({ it }) => {
        it('registers a persistent handler and returns this', () => {
            const tracker = new MockTracker();
            const emitter = new EventEmitter();
            const handler = tracker.fn();

            assertEqual(emitter, emitter.on('change', handler));

            emitter.emit('change', { id: 1 });
            emitter.emit('change', { id: 2 });

            assertEqual(2, handler.mock.callCount());
            assertEqual(1, handler.mock.getCall(0).arguments[0].id);
            assertEqual(2, handler.mock.getCall(1).arguments[0].id);
        });

        it('deduplicates the same handler for the same event', () => {
            const tracker = new MockTracker();
            const emitter = new EventEmitter();
            const handler = tracker.fn();

            emitter
                .on('change', handler)
                .on('change', handler)
                .emit('change');

            assertEqual(1, handler.mock.callCount());
        });
    });

    describe('EventEmitter#once', ({ it }) => {
        it('registers a one-time handler and returns this', () => {
            const tracker = new MockTracker();
            const emitter = new EventEmitter();
            const handler = tracker.fn();

            assertEqual(emitter, emitter.once('change', handler));

            emitter.emit('change', 'first');
            emitter.emit('change', 'second');

            assertEqual(1, handler.mock.callCount());
            assertEqual('first', handler.mock.getCall(0).arguments[0]);
        });

        it('preserves one-time handlers registered during an emit for the next emit', () => {
            const tracker = new MockTracker();
            const emitter = new EventEmitter();
            const secondHandler = tracker.fn();

            emitter.once('change', () => {
                emitter.once('change', secondHandler);
            });

            emitter.emit('change');
            assertEqual(0, secondHandler.mock.callCount());

            emitter.emit('change', 'next');
            assertEqual(1, secondHandler.mock.callCount());
            assertEqual('next', secondHandler.mock.getCall(0).arguments[0]);
        });

        it('deduplicates the same handler for the same event', () => {
            const tracker = new MockTracker();
            const emitter = new EventEmitter();
            const handler = tracker.fn();

            emitter
                .once('change', handler)
                .once('change', handler)
                .emit('change');

            assertEqual(1, handler.mock.callCount());
        });
    });

    describe('EventEmitter#off', ({ it }) => {
        it('removes a specific persistent handler', () => {
            const tracker = new MockTracker();
            const emitter = new EventEmitter();
            const firstHandler = tracker.fn();
            const secondHandler = tracker.fn();

            assertEqual(emitter, emitter
                .on('change', firstHandler)
                .on('change', secondHandler)
                .off('change', firstHandler));

            emitter.emit('change');

            assertEqual(0, firstHandler.mock.callCount());
            assertEqual(1, secondHandler.mock.callCount());
        });

        it('removes a specific one-time handler', () => {
            const tracker = new MockTracker();
            const emitter = new EventEmitter();
            const handler = tracker.fn();

            emitter
                .once('change', handler)
                .off('change', handler)
                .emit('change');

            assertEqual(0, handler.mock.callCount());
        });

        it('ignores removal of a handler for an event with no registered handlers', () => {
            const tracker = new MockTracker();
            const emitter = new EventEmitter();
            const handler = tracker.fn();

            assertEqual(emitter, emitter.off('change', handler));

            emitter.emit('change');

            assertEqual(0, handler.mock.callCount());
        });

        it('removes all handlers for one event', () => {
            const tracker = new MockTracker();
            const emitter = new EventEmitter();
            const changeHandler = tracker.fn();
            const saveHandler = tracker.fn();

            emitter
                .on('change', changeHandler)
                .once('change', changeHandler)
                .on('save', saveHandler)
                .off('change');

            emitter.emit('change');
            emitter.emit('save');

            assertEqual(0, changeHandler.mock.callCount());
            assertEqual(1, saveHandler.mock.callCount());
        });

        it('removes handlers for a falsy event name without clearing other events', () => {
            const tracker = new MockTracker();
            const emitter = new EventEmitter();
            const emptyNameHandler = tracker.fn();
            const otherHandler = tracker.fn();

            emitter
                .on('', emptyNameHandler)
                .on('change', otherHandler)
                .off('');

            emitter.emit('');
            emitter.emit('change');

            assertEqual(0, emptyNameHandler.mock.callCount());
            assertEqual(1, otherHandler.mock.callCount());
        });

        it('removes all handlers when called without arguments', () => {
            const tracker = new MockTracker();
            const emitter = new EventEmitter();
            const changeHandler = tracker.fn();
            const saveHandler = tracker.fn();

            emitter
                .on('change', changeHandler)
                .once('save', saveHandler)
                .off();

            emitter.emit('change');
            emitter.emit('save');

            assertEqual(0, changeHandler.mock.callCount());
            assertEqual(0, saveHandler.mock.callCount());
        });
    });

    describe('EventEmitter#emit', ({ it }) => {
        it('returns this', () => {
            const emitter = new EventEmitter();

            assertEqual(emitter, emitter.emit('change'));
        });

        it('throws when emitting an error event without handlers', () => {
            const emitter = new EventEmitter();
            const payload = new Error('emit failed');
            let caught = null;

            try {
                emitter.emit('error', payload);
            } catch (error) {
                caught = error;
            }

            assert(caught, 'expected an error to be thrown');
            assertEqual(payload, caught);
        });

        it('delivers error events to persistent handlers instead of throwing', () => {
            const tracker = new MockTracker();
            const emitter = new EventEmitter();
            const payload = new Error('emit failed');
            const handler = tracker.fn();

            assertEqual(emitter, emitter
                .on('error', handler)
                .emit('error', payload));

            assertEqual(1, handler.mock.callCount());
            assertEqual(payload, handler.mock.getCall(0).arguments[0]);
        });

        it('delivers error events to one-time handlers instead of throwing', () => {
            const tracker = new MockTracker();
            const emitter = new EventEmitter();
            const payload = new Error('emit failed');
            const handler = tracker.fn();

            assertEqual(emitter, emitter
                .once('error', handler)
                .emit('error', payload));

            assertEqual(1, handler.mock.callCount());
            assertEqual(payload, handler.mock.getCall(0).arguments[0]);
        });

        it('rethrows handler errors', () => {
            const emitter = new EventEmitter();
            let caught = null;

            emitter.on('change', () => {
                throw new Error('handler failed');
            });

            try {
                emitter.emit('change');
            } catch (error) {
                caught = error;
            }

            assert(caught, 'expected an error to be thrown');
            assertMatches('handler failed', caught.message);
        });

        it('delivers to persistent handlers snapshotted before emit-time mutation', () => {
            const tracker = new MockTracker();
            const emitter = new EventEmitter();
            const secondHandler = tracker.fn();

            emitter
                .on('change', () => {
                    emitter.off('change', secondHandler);
                })
                .on('change', secondHandler);

            emitter.emit('change', 'current');
            emitter.emit('change', 'next');

            assertEqual(1, secondHandler.mock.callCount());
            assertEqual('current', secondHandler.mock.getCall(0).arguments[0]);
        });

        it('delivers a single emit to both persistent and one-time handlers', () => {
            const tracker = new MockTracker();
            const emitter = new EventEmitter();
            const persistentHandler = tracker.fn();
            const onceHandler = tracker.fn();

            emitter
                .on('change', persistentHandler)
                .once('change', onceHandler)
                .emit('change', 'first')
                .emit('change', 'second');

            assertEqual(2, persistentHandler.mock.callCount());
            assertEqual('first', persistentHandler.mock.getCall(0).arguments[0]);
            assertEqual('second', persistentHandler.mock.getCall(1).arguments[0]);

            assertEqual(1, onceHandler.mock.callCount());
            assertEqual('first', onceHandler.mock.getCall(0).arguments[0]);
        });

        it('delivers to one-time handlers snapshotted before emit-time removal', () => {
            const tracker = new MockTracker();
            const emitter = new EventEmitter();
            const secondHandler = tracker.fn();

            // The first one-time handler removes the second mid-emit. Because emit
            // deletes the one-time set before invoking, the off() call is a no-op
            // and the second handler still receives the current event.
            emitter
                .once('change', () => {
                    emitter.off('change', secondHandler);
                })
                .once('change', secondHandler);

            emitter.emit('change', 'current');

            assertEqual(1, secondHandler.mock.callCount());
            assertEqual('current', secondHandler.mock.getCall(0).arguments[0]);
        });
    });

    describe('EventEmitter#clear', ({ it }) => {
        it('removes all handlers and returns this', () => {
            const tracker = new MockTracker();
            const emitter = new EventEmitter();
            const changeHandler = tracker.fn();
            const saveHandler = tracker.fn();

            emitter
                .on('change', changeHandler)
                .once('save', saveHandler);

            assertEqual(emitter, emitter.clear());

            emitter.emit('change');
            emitter.emit('save');

            assertEqual(0, changeHandler.mock.callCount());
            assertEqual(0, saveHandler.mock.callCount());
        });
    });
});
