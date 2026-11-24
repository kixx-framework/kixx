/**
 * Fakes of a Durable Object's state (`ctx`) and of a Durable Object namespace
 * binding whose stubs behave like RPC, for unit tests. With the fake storage
 * they form one model of a Durable Object.
 *
 * Shared on purpose. Test helpers are normally local to one test file. A fake
 * of a platform service is an exception, because every test of code that runs
 * in a Durable Object, or calls one, must meet the same platform rules. Only
 * test code imports this module.
 *
 * What it models, from Cloudflare's documentation:
 *
 * - `ctx.storage`, the fake SQLite storage.
 * - `ctx.blockConcurrencyWhile(callback)` returns the callback's promise, and
 *   calls to the object wait until it settles.
 * - `namespace.getByName(name)` returns a stub for the one object with that
 *   name. Each object has its own state and storage.
 * - A stub exposes the object's public prototype methods. Every call is
 *   async, and arguments and results are copied by structured clone, so
 *   neither side can change the other's objects.
 * - An error thrown by the object reaches the caller as a new `Error` with
 *   the same `name` and `message`, the serializable own properties (`code`
 *   and `cause` among them), and `remote: true`. It is not an instance of the
 *   original class.
 *
 * Where it is stricter than the platform:
 *
 * - Arguments and results may hold only primitives, plain objects, arrays,
 *   `Date`, `ArrayBuffer`, and views. Anything else rejects with a
 *   `DataCloneError`. The platform also passes `Map`, `Set`, and other
 *   built-in types. Widen the list when a real method needs one.
 *
 * What it doesn't model:
 *
 * - Resetting an object whose `blockConcurrencyWhile` callback rejected. The
 *   platform constructs the object again. In the fake, every later call to
 *   it rejects with that error, delivered like any error the object throws.
 * - On the state: `id`, the 30-second `blockConcurrencyWhile` timeout,
 *   `waitUntil`, `acceptWebSocket`, alarms, and `abort`.
 * - On the namespace: `idFromName`, `idFromString`, `newUniqueId`, `get(id)`,
 *   `jurisdiction`, and location hints.
 * - On a stub: `fetch`, reading a property that isn't a method, and the
 *   `retryable` and `overloaded` error markers. Tests script those failures
 *   with their own stubs.
 * - Input and output gates. Calls interleave at every `await`.
 * - The platform's error messages. The fake's messages are its own.
 *
 * Documentation, checked 2026-11-24:
 *
 * - https://developers.cloudflare.com/durable-objects/api/state/
 * - https://developers.cloudflare.com/durable-objects/best-practices/error-handling/
 * - https://developers.cloudflare.com/workers/runtime-apis/rpc/error-handling/
 *
 * When a run on Cloudflare shows that this fake differs from the platform,
 * fix the fake and pin the difference with a unit test.
 */

import { createFakeDurableObjectStorage } from './durable-object-storage.js';


// Each state's pending blockConcurrencyWhile() promises and first failure.
// Kept here, and not on the state, so that a state has only the platform's
// properties.
const concurrencyBlocks = new WeakMap();


/**
 * @typedef {import('./durable-object-storage.js').FakeDurableObjectStorage} FakeDurableObjectStorage
 */

/**
 * @typedef {Object} FakeDurableObjectState
 * @property {FakeDurableObjectStorage} storage - The object's storage
 * @property {function(function(): *): Promise<*>} blockConcurrencyWhile - Runs
 *   the callback and returns its promise. Stub calls to the object wait for
 *   it, and reject once it has rejected.
 */

/**
 * @typedef {Object} FakeDurableObjectNamespace
 * @property {function(string): Object} getByName - Returns a stub for the
 *   object with that name, creating the object on first use
 */

/**
 * Creates the state (`ctx`) a Durable Object is constructed with.
 * @param {Object} [options]
 * @param {FakeDurableObjectStorage} [options.storage] - The object's storage.
 *   The default is a new in-memory fake storage.
 * @returns {FakeDurableObjectState}
 */
export function createFakeDurableObjectState(options) {
    const {
        storage = createFakeDurableObjectStorage(),
    } = options ?? {};

    const block = { pending: new Set(), hasFailed: false, error: undefined };

    function blockConcurrencyWhile(callback) {
        // Called through an async function so that a synchronous throw rejects
        // the returned promise.
        const promise = (async () => await callback())();

        block.pending.add(promise);

        // Handling the rejection here also keeps a caller that discards the
        // returned promise from raising an unhandled rejection.
        promise.then(() => {
            block.pending.delete(promise);
        }, (error) => {
            block.pending.delete(promise);
            if (!block.hasFailed) {
                block.hasFailed = true;
                block.error = error;
            }
        });

        return promise;
    }

    const state = { storage, blockConcurrencyWhile };
    concurrencyBlocks.set(state, block);
    return state;
}

/**
 * Creates a Durable Object namespace binding.
 *
 * The first `getByName(name)` creates a new state and calls
 * `createObject(state)` once; later calls with that name return a stub over
 * the same object. A caller that needs bindings (`env`) closes over them in
 * `createObject`.
 *
 * A stub method waits for the object's pending `blockConcurrencyWhile` calls,
 * clones the arguments, calls the method, and clones the result. It rejects
 * with `TypeError` unless the name is a method on the object's prototype
 * chain, and with a `DataCloneError` when an argument or the result holds a
 * value the fake does not pass (see the module comment).
 * @param {function(FakeDurableObjectState): Object} createObject - Constructs
 *   the object for one name from its state. It must return a class instance:
 *   a stub calls only methods found on the prototype chain.
 * @returns {FakeDurableObjectNamespace}
 */
export function createFakeDurableObjectNamespace(createObject) {
    const instances = new Map();

    return {
        getByName(name) {
            if (typeof name !== 'string') {
                throw new TypeError('getByName() requires a string name');
            }

            if (!instances.has(name)) {
                const state = createFakeDurableObjectState();
                instances.set(name, { state, object: createObject(state) });
            }

            return createStub(instances.get(name));
        },
    };
}


function createStub(instance) {
    return new Proxy({}, {
        get(_target, property) {
            // A stub is not thenable, so it can be awaited and returned from
            // async functions. Symbols are never method names.
            if (typeof property !== 'string' || property === 'then') {
                return undefined;
            }

            return async (...args) => await callMethod(instance, property, args);
        },
    });
}

async function callMethod(instance, name, args) {
    const { state, object } = instance;

    await waitForConcurrencyBlocks(state);

    const method = findMethod(object, name);
    if (!method) {
        throw new TypeError(`The Durable Object does not implement the method "${ name }"`);
    }

    const clonedArgs = cloneForTransfer(args, `an argument of ${ name }()`);

    let result;
    try {
        result = await method.apply(object, clonedArgs);
    } catch (error) {
        throw toRemoteError(error);
    }

    return cloneForTransfer(result, `the result of ${ name }()`);
}

async function waitForConcurrencyBlocks(state) {
    const block = concurrencyBlocks.get(state);

    // Loop, because another blockConcurrencyWhile() can start while waiting.
    while (block.pending.size > 0) {
        await Promise.allSettled(block.pending);
    }

    if (block.hasFailed) {
        throw toRemoteError(block.error);
    }
}

// Only prototype methods are callable. Instance properties stay private to
// the object, and Object.prototype's methods are not part of its interface.
function findMethod(object, name) {
    if (name === 'constructor') {
        return null;
    }

    let prototype = Object.getPrototypeOf(object);

    while (prototype && prototype !== Object.prototype) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        if (descriptor) {
            return typeof descriptor.value === 'function' ? descriptor.value : null;
        }
        prototype = Object.getPrototypeOf(prototype);
    }

    return null;
}

function cloneForTransfer(value, description) {
    assertTransferable(value, description, new Set());
    return structuredClone(value);
}

// An allowlist on purpose: a class instance must not cross, and listing what
// may cross needs no catalog of every built-in type that structured clone
// accepts.
function assertTransferable(value, description, seen) {
    const type = typeof value;

    if (value === null || (type !== 'object' && type !== 'function' && type !== 'symbol')) {
        return;
    }
    if (type !== 'object') {
        throw new DOMException(`${ description } holds a ${ type }, which cannot be cloned`, 'DataCloneError');
    }
    if (value instanceof Date || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        return;
    }

    if (seen.has(value)) {
        return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
        for (const item of value) {
            assertTransferable(item, description, seen);
        }
        return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        const className = value.constructor?.name || 'object';
        throw new DOMException(`${ description } holds a ${ className } instance, which this fake does not pass to or from a Durable Object`, 'DataCloneError');
    }

    for (const key of Object.keys(value)) {
        assertTransferable(value[key], description, seen);
    }
}

function toRemoteError(thrown) {
    const error = toSerializedError(thrown);
    error.remote = true;
    return error;
}

// Rebuilds an error the way it arrives over RPC: a plain Error carrying the
// name, the message, and the own properties that can be serialized.
function toSerializedError(thrown) {
    if (!(thrown instanceof Error)) {
        return new Error(String(thrown));
    }

    const error = new Error(thrown.message);

    // The stack is among the own properties. Keeping the original one, which
    // the platform does not reliably deliver, makes a failing test point at
    // the code that threw.
    for (const key of Object.getOwnPropertyNames(thrown)) {
        const value = serializeErrorProperty(thrown[key]);

        if (value !== undefined) {
            error[key] = value;
        }
    }

    // The name is usually inherited from the class, not an own property.
    error.name = String(thrown.name);

    return error;
}

function serializeErrorProperty(value) {
    if (value instanceof Error) {
        return toSerializedError(value);
    }

    try {
        return structuredClone(value);
    } catch {
        // A property that cannot be serialized is left behind.
        return undefined;
    }
}
