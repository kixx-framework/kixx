import { describe } from 'kixx-test';
import { assertEqual, assertUndefined } from 'kixx-assert';
import sinon from 'sinon';
import EventEmitter from '../../lib/event-emitter.js';


describe('EventEmitter#on() when a listener is registered', ({ before, it }) => {
    const emitter = new EventEmitter();
    const listener = sinon.spy();

    before(() => {
        emitter.emit('test', 'payload');
        emitter.on('test', listener);
        emitter.emit('test', 'payload');
    });

    it('does not fire for events emitted before registration', () => {
        assertEqual(1, listener.callCount);
    });

    it('passes the event payload to the listener', () => {
        assertEqual('payload', listener.firstCall.firstArg);
    });
});

describe('EventEmitter#on() when a listener is registered and the event fires multiple times', ({ before, it }) => {
    const emitter = new EventEmitter();
    const listener = sinon.spy();

    before(() => {
        emitter.on('test', listener);
        emitter.emit('test', 1);
        emitter.emit('test', 2);
        emitter.emit('test', 3);
    });

    it('fires on every emit', () => {
        assertEqual(3, listener.callCount);
    });

    it('receives each payload in order', () => {
        assertEqual(1, listener.getCall(0).firstArg);
        assertEqual(2, listener.getCall(1).firstArg);
        assertEqual(3, listener.getCall(2).firstArg);
    });
});

describe('EventEmitter#on() when multiple listeners are registered for the same event', ({ before, it }) => {
    const emitter = new EventEmitter();
    const listenerA = sinon.spy();
    const listenerB = sinon.spy();

    before(() => {
        emitter.on('test', listenerA);
        emitter.on('test', listenerB);
        emitter.emit('test', 'payload');
    });

    it('calls every listener', () => {
        assertEqual(1, listenerA.callCount);
        assertEqual(1, listenerB.callCount);
    });
});

describe('EventEmitter#on() when listeners are registered for different events', ({ before, it }) => {
    const emitter = new EventEmitter();
    const listenerA = sinon.spy();
    const listenerB = sinon.spy();

    before(() => {
        emitter.on('a', listenerA);
        emitter.on('b', listenerB);
        emitter.emit('a', 'payload-a');
    });

    it('only fires the listener for the matching event', () => {
        assertEqual(1, listenerA.callCount);
        assertEqual(0, listenerB.callCount);
    });
});

describe('EventEmitter#on() return value', ({ it }) => {
    const emitter = new EventEmitter();

    it('returns the emitter instance for chaining', () => {
        assertEqual(emitter, emitter.on('test', sinon.spy()));
    });
});

describe('EventEmitter#once() when a listener is registered', ({ before, it }) => {
    const emitter = new EventEmitter();
    const listener = sinon.spy();

    before(() => {
        emitter.once('test', listener);
        emitter.emit('test', 'first');
        emitter.emit('test', 'second');
    });

    it('fires exactly once', () => {
        assertEqual(1, listener.callCount);
    });

    it('passes the payload from the first emit', () => {
        assertEqual('first', listener.firstCall.firstArg);
    });
});

describe('EventEmitter#once() return value', ({ it }) => {
    const emitter = new EventEmitter();

    it('returns the emitter instance for chaining', () => {
        assertEqual(emitter, emitter.once('test', sinon.spy()));
    });
});

describe('EventEmitter#off() when called with eventName and handler', ({ before, it }) => {
    const emitter = new EventEmitter();
    const persistent = sinon.spy();
    const removed = sinon.spy();

    before(() => {
        emitter.on('test', persistent);
        emitter.on('test', removed);
        emitter.off('test', removed);
        emitter.emit('test', 'payload');
    });

    it('stops calling the removed listener', () => {
        assertEqual(0, removed.callCount);
    });

    it('keeps calling other listeners for the same event', () => {
        assertEqual(1, persistent.callCount);
    });
});

describe('EventEmitter#off() when called with eventName and once-handler', ({ before, it }) => {
    const emitter = new EventEmitter();
    const listener = sinon.spy();

    before(() => {
        emitter.once('test', listener);
        emitter.off('test', listener);
        emitter.emit('test', 'payload');
    });

    it('stops calling the removed once-listener', () => {
        assertEqual(0, listener.callCount);
    });
});

describe('EventEmitter#off() when called with eventName only', ({ before, it }) => {
    const emitter = new EventEmitter();
    const persistentListener = sinon.spy();
    const onceListener = sinon.spy();
    const otherListener = sinon.spy();

    before(() => {
        emitter.on('test', persistentListener);
        emitter.once('test', onceListener);
        emitter.on('other', otherListener);
        emitter.off('test');
        emitter.emit('test', 'payload');
        emitter.emit('other', 'payload');
    });

    it('removes all persistent listeners for the event', () => {
        assertEqual(0, persistentListener.callCount);
    });

    it('removes all once-listeners for the event', () => {
        assertEqual(0, onceListener.callCount);
    });

    it('leaves listeners for other events intact', () => {
        assertEqual(1, otherListener.callCount);
    });
});

describe('EventEmitter#off() when called with no arguments', ({ before, it }) => {
    const emitter = new EventEmitter();
    const listenerA = sinon.spy();
    const listenerB = sinon.spy();

    before(() => {
        emitter.on('a', listenerA);
        emitter.on('b', listenerB);
        emitter.off();
        emitter.emit('a', 'payload');
        emitter.emit('b', 'payload');
    });

    it('removes all listeners for all events', () => {
        assertEqual(0, listenerA.callCount);
        assertEqual(0, listenerB.callCount);
    });
});

describe('EventEmitter#off() return value', ({ it }) => {
    const emitter = new EventEmitter();

    it('returns the emitter instance for chaining', () => {
        assertEqual(emitter, emitter.off('test'));
    });
});

describe('EventEmitter#emit() when no listeners are registered', ({ it }) => {
    const emitter = new EventEmitter();

    it('does not throw', () => {
        emitter.emit('nonexistent', 'payload');
    });
});

describe('EventEmitter#emit() return value', ({ it }) => {
    const emitter = new EventEmitter();

    it('returns the emitter instance for chaining', () => {
        assertEqual(emitter, emitter.emit('test'));
    });
});

describe('EventEmitter#emit() when emitted with no payload', ({ before, it }) => {
    const emitter = new EventEmitter();
    const listener = sinon.spy();

    before(() => {
        emitter.on('test', listener);
        emitter.emit('test');
    });

    it('calls the listener with undefined payload', () => {
        assertEqual(1, listener.callCount);
        assertUndefined(listener.firstCall.firstArg);
    });
});

describe('EventEmitter#once() when a once-listener is added during emit', ({ before, it }) => {
    const emitter = new EventEmitter();
    const addedDuringEmit = sinon.spy();

    before(() => {
        emitter.once('test', () => {
            // Register a new once-listener while the current emit is in progress
            emitter.once('test', addedDuringEmit);
        });
        emitter.emit('test');
        emitter.emit('test');
    });

    it('fires the re-entrant once-listener on the next emit, not the current one', () => {
        assertEqual(1, addedDuringEmit.callCount);
    });
});
