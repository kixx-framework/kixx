import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertUndefined } from 'kixx-assert';

import { createFakeDurableObjectStorage } from './durable-object-storage.js';
import { createFakeDurableObjectNamespace, createFakeDurableObjectState } from './durable-object.js';


class NotesError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'NotesError';
        this.code = 'NOTES_ERROR';
    }
}

// A small Durable Object. Its constructor follows the pattern Kixx objects
// use: prepare storage inside blockConcurrencyWhile().
class Notes {

    isSecret = true;

    instanceMethod = () => 'not callable';

    #sql;

    #last = { text: null, tags: [] };

    constructor(ctx, hooks) {
        const {
            onConstruct = () => {},
            initialize = () => {},
        } = hooks ?? {};

        this.#sql = ctx.storage.sql;
        onConstruct(this, ctx);

        this.ready = ctx.blockConcurrencyWhile(async () => {
            await initialize();
            this.#sql.exec('CREATE TABLE IF NOT EXISTS notes (text TEXT NOT NULL)');
        });
    }

    add(text) {
        this.#sql.exec('INSERT INTO notes (text) VALUES (?)', text);
    }

    async count() {
        return this.#sql.exec('SELECT count(*) AS n FROM notes').one().n;
    }

    remember(note) {
        this.#last = note;
        note.tags.push('seen');
    }

    getLast() {
        return this.#last;
    }

    echo(...values) {
        return values;
    }

    getMap() {
        return new Map();
    }

    getInstance() {
        return this;
    }

    fail() {
        throw new NotesError('note rejected');
    }

    failWithCause() {
        throw new NotesError('note rejected', { cause: new NotesError('underneath') });
    }

    failWithProperties() {
        throw Object.assign(new NotesError('note rejected'), {
            httpStatusCode: 409,
            details: { pathname: '/a' },
            callback: () => {},
            remote: false,
        });
    }

    failWithTypeError() {
        return null.length;
    }

    failWithString() {
        const value = 'just a string';
        throw value;
    }
}

function makeNamespace(hooks) {
    return createFakeDurableObjectNamespace((state) => new Notes(state, hooks));
}

function makeDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

// Lets every already-queued promise reaction run.
async function flushPromises() {
    await new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}


describe('fake Durable Object', ({ describe }) => {
    describe('createFakeDurableObjectState', ({ it }) => {
        it('has an in-memory storage of its own by default', () => {
            const first = createFakeDurableObjectState();
            const second = createFakeDurableObjectState();

            first.storage.sql.exec('CREATE TABLE t (k)');

            assertEqual(1, first.storage.sql.exec('SELECT count(*) AS n FROM sqlite_master').one().n);
            assertEqual(0, second.storage.sql.exec('SELECT count(*) AS n FROM sqlite_master').one().n);
        });

        it('uses the storage it is given', () => {
            const storage = createFakeDurableObjectStorage();

            const state = createFakeDurableObjectState({ storage });

            assertEqual(storage, state.storage);
        });

        it('has only the modeled properties', () => {
            const state = createFakeDurableObjectState();

            assertEqual('blockConcurrencyWhile,storage', Object.keys(state).sort().join(','));
        });

        it('runs the blockConcurrencyWhile() callback and returns its promise', async () => {
            const state = createFakeDurableObjectState();
            let callCount = 0;

            const promise = state.blockConcurrencyWhile(async () => {
                callCount += 1;
                return 'ready';
            });

            assert(promise instanceof Promise, 'expected a Promise');
            assertEqual('ready', await promise);
            assertEqual(1, callCount);
        });

        it('rejects the returned promise when the callback rejects or throws', async () => {
            const state = createFakeDurableObjectState();

            const rejected = await catchAsyncError(() => state.blockConcurrencyWhile(async () => {
                throw new Error('rejected');
            }));
            const thrown = await catchAsyncError(() => state.blockConcurrencyWhile(() => {
                throw new Error('thrown');
            }));

            assertEqual('rejected', rejected.message);
            assertEqual('thrown', thrown.message);
        });
    });

    describe('createFakeDurableObjectNamespace', ({ describe }) => {
        describe('getByName', ({ it }) => {
            it('creates one object per name', async () => {
                const constructed = [];
                const namespace = makeNamespace({ onConstruct: (object) => constructed.push(object) });

                await namespace.getByName('a').add('first');
                await namespace.getByName('a').add('second');

                assertEqual(1, constructed.length);
                assertEqual(2, await namespace.getByName('a').count());
            });

            it('gives each name its own object and storage', async () => {
                const states = [];
                const namespace = makeNamespace({ onConstruct: (_object, state) => states.push(state) });

                await namespace.getByName('a').add('only in a');

                assertEqual(1, await namespace.getByName('a').count());
                assertEqual(0, await namespace.getByName('b').count());
                assertEqual(2, states.length);
                assert(states[0].storage !== states[1].storage, 'expected separate storage');
            });

            it('creates the object on the first getByName(), before any call', () => {
                const constructed = [];
                const namespace = makeNamespace({ onConstruct: (object) => constructed.push(object) });

                namespace.getByName('a');

                assertEqual(1, constructed.length);
            });

            it('throws TypeError unless the name is a string', () => {
                const namespace = makeNamespace();
                let caught = null;

                try {
                    namespace.getByName(undefined);
                } catch (error) {
                    caught = error;
                }

                assert(caught, 'expected getByName() to throw');
                assertEqual('TypeError', caught.name);
            });
        });

        describe('a stub', ({ it }) => {
            it('returns a promise from every method, async or not', async () => {
                const stub = makeNamespace().getByName('a');

                const fromSync = stub.add('note');
                const fromAsync = stub.count();

                assert(fromSync instanceof Promise, 'expected a Promise from a sync method');
                assert(fromAsync instanceof Promise, 'expected a Promise from an async method');
                assertUndefined(await fromSync);
                assertEqual(1, await fromAsync);
            });

            it('is not thenable', async () => {
                const stub = makeNamespace().getByName('a');

                const awaited = await stub;

                assertUndefined(stub.then);
                assertEqual(stub, awaited);
            });

            it('rejects with TypeError for a name the object does not implement', async () => {
                const stub = makeNamespace().getByName('a');

                const caught = await catchAsyncError(() => stub.missing());

                assert(caught, 'expected the call to reject');
                assertEqual('TypeError', caught.name);
                assertMatches('"missing"', caught.message);
            });

            it('rejects with TypeError for anything that is not a prototype method', async () => {
                const stub = makeNamespace().getByName('a');

                // The constructor, an instance field, a function-valued
                // instance field, and a method of Object.prototype.
                for (const name of [ 'constructor', 'isSecret', 'instanceMethod', 'ready', 'toString' ]) {
                    const caught = await catchAsyncError(() => stub[name]());

                    assert(caught, `expected ${ name }() to reject`);
                    assertEqual('TypeError', caught.name);
                }
            });

            it('calls methods inherited from a parent class', async () => {
                class LoudNotes extends Notes {}
                const namespace = createFakeDurableObjectNamespace((state) => new LoudNotes(state));

                await namespace.getByName('a').add('note');

                assertEqual(1, await namespace.getByName('a').count());
            });
        });

        describe('arguments and results', ({ it }) => {
            it('passes the object a copy of each argument', async () => {
                const stub = makeNamespace().getByName('a');
                const note = { text: 'original', tags: [ 'new' ] };

                await stub.remember(note);
                note.text = 'changed by the caller';

                // The object pushed a tag onto its copy, and kept its text.
                assertEqual('new', note.tags.join(','));
                assertEqual('original', (await stub.getLast()).text);
            });

            it('returns a copy of the result', async () => {
                const stub = makeNamespace().getByName('a');
                await stub.remember({ text: 'original', tags: [] });

                const first = await stub.getLast();
                first.text = 'changed by the caller';
                first.tags.push('changed');
                const second = await stub.getLast();

                assertEqual('original', second.text);
                assertEqual('seen', second.tags.join(','));
            });

            it('passes primitives, plain objects, arrays, Dates, ArrayBuffers, and views', async () => {
                const stub = makeNamespace().getByName('a');
                const nullPrototype = Object.assign(Object.create(null), { nested: [ { deep: true } ] });

                const result = await stub.echo(
                    'text',
                    42,
                    true,
                    null,
                    undefined,
                    nullPrototype,
                    new Date('2026-11-24T00:00:00.000Z'),
                    new Uint8Array([ 1, 2 ]).buffer,
                    new Uint8Array([ 3, 4 ]),
                );

                assertEqual('text', result[0]);
                assertEqual(42, result[1]);
                assertEqual(true, result[2]);
                assertEqual(null, result[3]);
                assertUndefined(result[4]);
                assertEqual(true, result[5].nested[0].deep);
                assertEqual('2026-11-24T00:00:00.000Z', result[6].toISOString());
                assert(result[7] instanceof ArrayBuffer, 'expected an ArrayBuffer');
                assertEqual('1,2', Array.from(new Uint8Array(result[7])).join(','));
                assert(result[8] instanceof Uint8Array, 'expected a Uint8Array');
                assertEqual('3,4', Array.from(result[8]).join(','));
            });

            it('rejects a class-instance argument with a DataCloneError, without calling the method', async () => {
                class Record {
                    text = 'from a class';
                }
                const stub = makeNamespace().getByName('a');

                const direct = await catchAsyncError(() => stub.remember(new Record()));
                const nested = await catchAsyncError(() => stub.remember({ text: 'plain', tags: [ { record: new Record() } ] }));

                assert(direct, 'expected the class instance to reject');
                assertEqual('DataCloneError', direct.name);
                assertMatches('Record', direct.message);
                assert(nested, 'expected the nested class instance to reject');
                assertEqual('DataCloneError', nested.name);
                assertEqual(null, (await stub.getLast()).text);
            });

            it('rejects an argument that is not on the allowlist with a DataCloneError', async () => {
                const stub = makeNamespace().getByName('a');

                for (const value of [ new Map(), new Set(), () => {}, Symbol('s'), new Error('e'), /x/ ]) {
                    const caught = await catchAsyncError(() => stub.echo(value));

                    assert(caught, `expected ${ Object.prototype.toString.call(value) } to reject`);
                    assertEqual('DataCloneError', caught.name);
                }
            });

            it('rejects a result that is not on the allowlist with a DataCloneError', async () => {
                const stub = makeNamespace().getByName('a');

                const map = await catchAsyncError(() => stub.getMap());
                const instance = await catchAsyncError(() => stub.getInstance());

                assert(map, 'expected the Map result to reject');
                assertEqual('DataCloneError', map.name);
                assert(instance, 'expected the class-instance result to reject');
                assertEqual('DataCloneError', instance.name);
            });
        });

        describe('errors', ({ it }) => {
            it('delivers a thrown error as a new Error with name, message, code, and remote', async () => {
                const stub = makeNamespace().getByName('a');

                const caught = await catchAsyncError(() => stub.fail());

                assert(caught, 'expected the call to reject');
                assertEqual('NotesError', caught.name);
                assertEqual('note rejected', caught.message);
                assertEqual('NOTES_ERROR', caught.code);
                assertEqual(true, caught.remote);
                assert(caught instanceof Error, 'expected an Error');
                assertEqual(false, caught instanceof NotesError);
                assertEqual(Error.prototype, Object.getPrototypeOf(caught));
            });

            it('delivers the cause the same way, without marking it remote', async () => {
                const stub = makeNamespace().getByName('a');

                const caught = await catchAsyncError(() => stub.failWithCause());

                assertEqual('NotesError', caught.cause.name);
                assertEqual('underneath', caught.cause.message);
                assertEqual('NOTES_ERROR', caught.cause.code);
                assertEqual(false, caught.cause instanceof NotesError);
                assertUndefined(caught.cause.remote);
            });

            it('copies the own properties that can be serialized and leaves the rest', async () => {
                const stub = makeNamespace().getByName('a');

                const caught = await catchAsyncError(() => stub.failWithProperties());

                assertEqual(409, caught.httpStatusCode);
                assertEqual('/a', caught.details.pathname);
                assertEqual(false, Object.hasOwn(caught, 'callback'));
                assertEqual(true, caught.remote);
            });

            it('keeps the name of a built-in error class', async () => {
                const stub = makeNamespace().getByName('a');

                const caught = await catchAsyncError(() => stub.failWithTypeError());

                assertEqual('TypeError', caught.name);
                assertEqual(true, caught.remote);
                assertEqual(false, caught instanceof TypeError);
            });

            it('keeps the stack of the code that threw', async () => {
                const stub = makeNamespace().getByName('a');

                const caught = await catchAsyncError(() => stub.fail());

                assertMatches('Notes.fail', caught.stack);
            });

            it('delivers a thrown value that is not an Error as an Error', async () => {
                const stub = makeNamespace().getByName('a');

                const caught = await catchAsyncError(() => stub.failWithString());

                assert(caught instanceof Error, 'expected an Error');
                assertEqual('just a string', caught.message);
                assertEqual(true, caught.remote);
            });
        });

        describe('blockConcurrencyWhile', ({ it }) => {
            it('holds calls until the pending promise settles', async () => {
                const initialization = makeDeferred();
                const stub = makeNamespace({ initialize: () => initialization.promise }).getByName('a');
                let isSettled = false;

                // count() fails with "no such table" if it runs before the
                // constructor's callback has created the table.
                const call = stub.count().finally(() => {
                    isSettled = true;
                });
                await flushPromises();
                const wasSettledWhilePending = isSettled;
                initialization.resolve();

                assertEqual(false, wasSettledWhilePending);
                assertEqual(0, await call);
            });

            it('holds calls for a block that starts while they wait', async () => {
                const first = makeDeferred();
                const second = makeDeferred();
                let state;
                const namespace = makeNamespace({
                    initialize: () => first.promise,
                    onConstruct(_object, ctx) {
                        state = ctx;
                    },
                });
                const stub = namespace.getByName('a');
                let isSettled = false;

                const call = stub.count().finally(() => {
                    isSettled = true;
                });
                state.blockConcurrencyWhile(() => second.promise);
                first.resolve();
                await flushPromises();
                const wasSettledWhilePending = isSettled;
                second.resolve();

                assertEqual(false, wasSettledWhilePending);
                assertEqual(0, await call);
            });

            it('rejects waiting and later calls once a block has rejected', async () => {
                const initialization = makeDeferred();
                const stub = makeNamespace({ initialize: () => initialization.promise }).getByName('a');

                const waiting = catchAsyncError(() => stub.count());
                initialization.reject(new NotesError('incompatible schema'));
                const first = await waiting;
                const later = await catchAsyncError(() => stub.add('note'));

                for (const caught of [ first, later ]) {
                    assert(caught, 'expected the call to reject');
                    assertEqual('NotesError', caught.name);
                    assertEqual('incompatible schema', caught.message);
                    assertEqual('NOTES_ERROR', caught.code);
                    assertEqual(true, caught.remote);
                }
            });

            it('does not raise an unhandled rejection when the object discards the promise', async () => {
                const namespace = createFakeDurableObjectNamespace((state) => {
                    // Discards the promise, as a constructor may.
                    state.blockConcurrencyWhile(async () => {
                        throw new Error('constructor failed');
                    });
                    return new (class Broken {
                        ping() {
                            return 'pong';
                        }
                    })();
                });

                const caught = await catchAsyncError(() => namespace.getByName('a').ping());

                assertEqual('constructor failed', caught.message);
            });
        });
    });
});
