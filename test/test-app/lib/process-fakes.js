/**
 * Fakes for the tests of test-app/lib/: a clock, `spawn`, and `fetch`. No
 * process is started and no request is made.
 */
import { EventEmitter } from 'node:events';


const FIRST_PROCESS_ID = 4000;

// A turn of the event loop, without the millisecond a zero timeout costs.
const defer = globalThis.setImmediate ?? ((fn) => setTimeout(fn, 0));

/**
 * A clock that never waits. A timer fires on a later turn of the event
 * loop, in order of its due time, and moves `now()` to that time. So code
 * that sleeps between polls runs through at once, and a timer that is
 * cleared before its turn never fires.
 *
 * @param {number} [start]
 * @returns {{ now: function(): number, setTimeout: Function, clearTimeout: Function }}
 */
export function createFakeClock(start = 1000000) {
    const timers = [];

    let now = start;
    let nextId = 1;
    let isPumping = false;

    function pump() {
        isPumping = false;

        if (timers.length === 0) {
            return;
        }

        timers.sort((a, b) => a.due - b.due || a.id - b.id);

        const timer = timers.shift();

        now = Math.max(now, timer.due);
        timer.fn();

        schedule();
    }

    function schedule() {
        if (!isPumping && timers.length > 0) {
            isPumping = true;
            defer(pump);
        }
    }

    return {
        now: () => now,

        setTimeout(fn, milliseconds) {
            const id = nextId;

            nextId += 1;
            timers.push({ id, fn, due: now + milliseconds });
            schedule();

            return id;
        },

        clearTimeout(id) {
            const index = timers.findIndex((timer) => timer.id === id);

            if (index !== -1) {
                timers.splice(index, 1);
            }
        },
    };
}

/**
 * A child process that does only what a test tells it to.
 *
 * - `write(name, text)` emits a chunk on `stdout` or `stderr`.
 * - `exit(code, signal)` ends it: 'exit', then 'close'.
 * - `receive(signal)` records the signal in `signals` and calls `onKill`,
 *   where a test decides what the signal does. The fake spawn's `kill(pid,
 *   signal)` calls it.
 * - `kill()` is the child's own method, which nothing should call: it
 *   records the call in `ownKills`.
 */
export function createFakeChild({ piped = true } = {}) {
    const child = new EventEmitter();

    child.signals = [];
    child.ownKills = [];
    child.exited = false;
    child.onKill = null;

    child.stdout = piped ? createFakeStream() : null;
    child.stderr = piped ? createFakeStream() : null;

    child.write = (name, text) => {
        child[name].emit('data', text);
    };

    child.exit = (code, signal = null) => {
        if (!child.exited) {
            child.exited = true;
            child.emit('exit', code, signal);
            child.emit('close', code, signal);
        }
    };

    child.receive = (signal) => {
        child.signals.push(signal);

        if (child.onKill) {
            child.onKill(signal);
        }
    };

    child.kill = (signal) => {
        child.ownKills.push(signal);
        return true;
    };

    return child;
}

/**
 * A `spawn` that records each call in `spawn.calls` as `{ command, args,
 * options, child }` and hands the new child to `onSpawn(call)`, where a test
 * scripts it. Each child gets a process id, and `spawn.kill(pid, signal)`
 * stands in for `process.kill`: it throws ESRCH for a process that has
 * exited, as the real one does.
 *
 * @param {function(Object): void} [onSpawn]
 */
export function createFakeSpawn(onSpawn) {
    function spawn(command, args, options) {
        const child = createFakeChild({ piped: options?.stdio !== 'inherit' });
        const call = { command, args, options, child };

        child.pid = FIRST_PROCESS_ID + spawn.calls.length;

        spawn.calls.push(call);

        if (onSpawn) {
            onSpawn(call);
        }

        return child;
    }

    spawn.calls = [];

    spawn.kill = (pid, signal) => {
        const call = spawn.calls.find(({ child }) => child.pid === pid);

        if (!call || call.child.exited) {
            const error = new Error('kill ESRCH');

            error.code = 'ESRCH';
            throw error;
        }

        call.child.receive(signal);
    };

    return spawn;
}

/**
 * A `fetch` that answers what `respond(url, init)` returns, and refuses the
 * connection when that is nothing. It records each call in `fetch.calls`.
 *
 * @param {function(string, Object): (Object|undefined)} respond
 */
export function createFakeFetch(respond) {
    async function fetch(url, init) {
        fetch.calls.push({ url, init });

        const response = respond(url, init);

        if (!response) {
            throw new TypeError('fetch failed');
        }

        return response;
    }

    fetch.calls = [];

    return fetch;
}


function createFakeStream() {
    const stream = new EventEmitter();

    stream.encoding = null;

    stream.setEncoding = (encoding) => {
        stream.encoding = encoding;
    };

    return stream;
}
