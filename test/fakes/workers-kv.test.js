import { describe, MockTracker } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertUndefined } from 'kixx-assert';

import { createFakeKVNamespace } from './workers-kv.js';


// A round second, so that expirations in seconds line up with the clock.
const START = 1800000000000;

const MAX_VALUE_BYTES = 25 * 1024 * 1024;

function makeClock() {
    let time = START;
    return {
        now: () => time,
        advance(milliseconds) {
            time += milliseconds;
        },
    };
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

function toBytes(buffer) {
    return Array.from(new Uint8Array(buffer)).join(',');
}


describe('createFakeKVNamespace', ({ describe }) => {
    describe('initial values', ({ it }) => {
        it('seeds from a plain object without logging calls', async () => {
            const kv = createFakeKVNamespace({ initial: { greeting: 'hello', bytes: new Uint8Array([ 1, 2 ]).buffer } });

            assertEqual(0, kv.calls.length);
            assertEqual('hello', await kv.get('greeting'));
            assertEqual('1,2', toBytes(await kv.get('bytes', 'arrayBuffer')));
        });

        it('seeds from a Map', async () => {
            const kv = createFakeKVNamespace({ initial: new Map([ [ 'hash-a#1', 'the bytes' ] ]) });

            assertEqual(0, kv.calls.length);
            assertEqual('the bytes', await kv.get('hash-a#1'));
        });

        it('does not count a seeded value toward the write rate', async () => {
            const kv = createFakeKVNamespace({ initial: { greeting: 'hello' }, now: makeClock().now });

            await kv.put('greeting', 'replaced');

            assertEqual('replaced', await kv.get('greeting'));
        });

        it('throws for an initial that is not a Map or a plain object', () => {
            const caught = catchError(() => createFakeKVNamespace({ initial: [ [ 'key', 'value' ] ] }));

            assert(caught, 'expected the factory to throw');
            assertEqual('TypeError', caught.name);
        });

        it('throws for a seeded key or value that put() would reject', () => {
            const badKey = catchError(() => createFakeKVNamespace({ initial: { '..': 'value' } }));
            const badValue = catchError(() => createFakeKVNamespace({ initial: { key: 42 } }));

            assert(badKey, 'expected the seeded key to throw');
            assert(badValue, 'expected the seeded value to throw');
            assertEqual('TypeError', badValue.name);
        });
    });

    describe('calls', ({ it }) => {
        it('records each call in order with its arguments as passed', async () => {
            const kv = createFakeKVNamespace();
            const getOptions = { type: 'json', cacheTtl: 60 };
            const putOptions = { expirationTtl: 60 };
            const value = new TextEncoder().encode('{"n":1}');

            await kv.put('a', value, putOptions);
            await kv.get('a', getOptions);
            await kv.get([ 'a', 'b' ], 'text');
            await kv.delete('a');

            assertEqual(4, kv.calls.length);
            assertEqual('put,get,get,delete', kv.calls.map((call) => call.method).join(','));
            assertEqual('a', kv.calls[0].key);
            assertEqual(value, kv.calls[0].value);
            assertEqual(putOptions, kv.calls[0].options);
            assertEqual(getOptions, kv.calls[1].options);
            assertUndefined(kv.calls[1].value);
            assertEqual('a,b', kv.calls[2].key.join(','));
            assertEqual('text', kv.calls[2].options);
            assertEqual('a', kv.calls[3].key);
        });

        it('records options that were not passed as undefined', async () => {
            const kv = createFakeKVNamespace();

            await kv.put('a', 'value');
            await kv.get('a');
            await kv.delete('a');

            assertEqual(3, kv.calls.length);
            for (const call of kv.calls) {
                assertEqual(true, Object.hasOwn(call, 'options'));
                assertUndefined(call.options);
            }
        });

        it('records a call that rejects', async () => {
            const kv = createFakeKVNamespace();

            await catchAsyncError(() => kv.put('', 'value'));

            assertEqual(1, kv.calls.length);
            assertEqual('put', kv.calls[0].method);
        });
    });

    describe('keys', ({ it }) => {
        // 'é' is one character and two bytes.
        const longestKey = 'é'.repeat(256);
        const tooLongKey = `${ longestKey }a`;

        it('accepts a key of 512 bytes', async () => {
            const kv = createFakeKVNamespace();

            await kv.put(longestKey, 'value');

            assertEqual('value', await kv.get(longestKey));
            assertEqual('value', (await kv.get([ longestKey ])).get(longestKey));
            assertUndefined(await kv.delete(longestKey));
        });

        it('rejects a key of 513 bytes in every method', async () => {
            const kv = createFakeKVNamespace();

            const results = [
                await catchAsyncError(() => kv.get(tooLongKey)),
                await catchAsyncError(() => kv.get([ 'a', tooLongKey ])),
                await catchAsyncError(() => kv.put(tooLongKey, 'value')),
                await catchAsyncError(() => kv.delete(tooLongKey)),
            ];

            for (const caught of results) {
                assert(caught, 'expected the long key to reject');
                assertMatches('512 bytes', caught.message);
            }
        });

        it('rejects an empty key, ".", and ".." in every method', async () => {
            const kv = createFakeKVNamespace();

            for (const key of [ '', '.', '..' ]) {
                const results = [
                    await catchAsyncError(() => kv.get(key)),
                    await catchAsyncError(() => kv.get([ 'a', key ])),
                    await catchAsyncError(() => kv.put(key, 'value')),
                    await catchAsyncError(() => kv.delete(key)),
                ];

                for (const caught of results) {
                    assert(caught, `expected the key ${ JSON.stringify(key) } to reject`);
                    assertMatches('is not allowed as a key', caught.message);
                }
            }
        });

        it('accepts keys that only contain dots', async () => {
            const kv = createFakeKVNamespace();

            await kv.put('...', 'value');
            await kv.put('a.b', 'value');

            assertEqual('value', await kv.get('...'));
        });

        it('rejects a key that is not a string with TypeError', async () => {
            const kv = createFakeKVNamespace();

            const results = [
                await catchAsyncError(() => kv.get(42)),
                await catchAsyncError(() => kv.get(undefined)),
                await catchAsyncError(() => kv.get([ 'a', null ])),
                await catchAsyncError(() => kv.put({}, 'value')),
                await catchAsyncError(() => kv.delete(null)),
            ];

            for (const caught of results) {
                assert(caught, 'expected the key to reject');
                assertEqual('TypeError', caught.name);
            }
        });
    });

    describe('get', ({ it }) => {
        it('resolves null for a missing key, whatever the type', async () => {
            const kv = createFakeKVNamespace();

            assertEqual(null, await kv.get('missing'));
            assertEqual(null, await kv.get('missing', 'json'));
            assertEqual(null, await kv.get('missing', { type: 'arrayBuffer' }));
            assertEqual(null, await kv.get('missing', { type: 'stream' }));
        });

        it('reads text by default', async () => {
            const kv = createFakeKVNamespace({ initial: { greeting: 'héllo 世界' } });

            assertEqual('héllo 世界', await kv.get('greeting'));
            assertEqual('héllo 世界', await kv.get('greeting', 'text'));
            assertEqual('héllo 世界', await kv.get('greeting', { type: 'text' }));
            assertEqual('héllo 世界', await kv.get('greeting', { cacheTtl: 60 }));
        });

        it('decodes stored bytes as UTF-8 for a text read', async () => {
            const kv = createFakeKVNamespace({ initial: { greeting: new TextEncoder().encode('héllo 世界') } });

            assertEqual('héllo 世界', await kv.get('greeting'));
        });

        it('returns a stored string exactly, even one that is not valid UTF-16', async () => {
            const kv = createFakeKVNamespace();
            const loneSurrogate = 'a\ud800b';

            await kv.put('odd', loneSurrogate);

            assertEqual(loneSurrogate, await kv.get('odd'));
        });

        it('parses json from a stored string or stored bytes', async () => {
            const json = JSON.stringify({ name: 'Kris', tags: [ 'a' ] });
            const kv = createFakeKVNamespace({ initial: { text: json, bytes: new TextEncoder().encode(json) } });

            const fromText = await kv.get('text', { type: 'json' });
            const fromBytes = await kv.get('bytes', 'json');

            assertEqual('Kris', fromText.name);
            assertEqual('a', fromText.tags[0]);
            assertEqual('Kris', fromBytes.name);
        });

        it('rejects a json read of a value that is not JSON with SyntaxError', async () => {
            const kv = createFakeKVNamespace({ initial: { greeting: 'hello' } });

            const caught = await catchAsyncError(() => kv.get('greeting', 'json'));

            assert(caught, 'expected the read to reject');
            assertEqual('SyntaxError', caught.name);
        });

        it('reads an arrayBuffer from stored bytes or a stored string', async () => {
            const kv = createFakeKVNamespace({ initial: { bytes: new Uint8Array([ 1, 2, 3 ]), text: 'é' } });

            const fromBytes = await kv.get('bytes', 'arrayBuffer');
            const fromText = await kv.get('text', { type: 'arrayBuffer' });

            assert(fromBytes instanceof ArrayBuffer, 'expected an ArrayBuffer');
            assertEqual('1,2,3', toBytes(fromBytes));
            assert(fromText instanceof ArrayBuffer, 'expected an ArrayBuffer');
            assertEqual('195,169', toBytes(fromText));
        });

        it('returns a fresh arrayBuffer for every read', async () => {
            const kv = createFakeKVNamespace({ initial: { bytes: new Uint8Array([ 1, 2, 3 ]) } });

            const first = await kv.get('bytes', 'arrayBuffer');
            new Uint8Array(first).fill(9);
            const second = await kv.get('bytes', 'arrayBuffer');

            assertEqual('1,2,3', toBytes(second));
        });

        it('reads a stream of the bytes', async () => {
            const kv = createFakeKVNamespace({ initial: { bytes: new Uint8Array([ 1, 2, 3 ]), text: 'é', empty: new ArrayBuffer(0) } });

            const fromBytes = await kv.get('bytes', 'stream');
            const fromText = await kv.get('text', { type: 'stream' });
            const fromEmpty = await kv.get('empty', 'stream');

            assert(fromBytes instanceof ReadableStream, 'expected a ReadableStream');
            assertEqual('1,2,3', toBytes(await new Response(fromBytes).arrayBuffer()));
            assertEqual('195,169', toBytes(await new Response(fromText).arrayBuffer()));
            assertEqual(0, (await new Response(fromEmpty).arrayBuffer()).byteLength);
        });

        it('accepts a cacheTtl of 30 and rejects 29', async () => {
            const kv = createFakeKVNamespace({ initial: { greeting: 'hello' } });

            const value = await kv.get('greeting', { type: 'text', cacheTtl: 30 });
            const caught = await catchAsyncError(() => kv.get('greeting', { type: 'text', cacheTtl: 29 }));
            const bulk = await catchAsyncError(() => kv.get([ 'greeting' ], { cacheTtl: 29 }));

            assertEqual('hello', value);
            assert(caught, 'expected a cacheTtl of 29 to reject');
            assertMatches('at least 30', caught.message);
            assert(bulk, 'expected a bulk cacheTtl of 29 to reject');
        });

        it('treats an undefined cacheTtl as not given', async () => {
            const kv = createFakeKVNamespace({ initial: { greeting: 'hello' } });

            assertEqual('hello', await kv.get('greeting', { type: 'text', cacheTtl: undefined }));
        });

        it('rejects an unknown type or wrong option types with TypeError', async () => {
            const kv = createFakeKVNamespace({ initial: { greeting: 'hello' } });

            const results = [
                await catchAsyncError(() => kv.get('greeting', 'buffer')),
                await catchAsyncError(() => kv.get('greeting', { type: 'blob' })),
                await catchAsyncError(() => kv.get('greeting', 42)),
                await catchAsyncError(() => kv.get('greeting', null)),
                await catchAsyncError(() => kv.get('greeting', { cacheTtl: '60' })),
            ];

            for (const caught of results) {
                assert(caught, 'expected the read to reject');
                assertEqual('TypeError', caught.name);
            }
        });
    });

    describe('get with an array of keys', ({ it }) => {
        it('resolves a Map with an entry for each key and null for a missing one', async () => {
            const kv = createFakeKVNamespace({ initial: { a: 'A', b: 'B' } });

            const values = await kv.get([ 'b', 'missing', 'a' ]);

            assert(values instanceof Map, 'expected a Map');
            assertEqual(3, values.size);
            assertEqual('b,missing,a', Array.from(values.keys()).join(','));
            assertEqual('A', values.get('a'));
            assertEqual('B', values.get('b'));
            assertEqual(null, values.get('missing'));
        });

        it('collapses duplicate keys', async () => {
            const kv = createFakeKVNamespace({ initial: { a: 'A' } });

            const values = await kv.get([ 'a', 'a', 'missing', 'missing' ], { type: 'text' });

            assertEqual(2, values.size);
        });

        it('parses json values', async () => {
            const kv = createFakeKVNamespace({ initial: { a: '{"n":1}' } });

            const values = await kv.get([ 'a', 'missing' ], 'json');

            assertEqual(1, values.get('a').n);
            assertEqual(null, values.get('missing'));
        });

        it('accepts 100 keys and rejects 101', async () => {
            const kv = createFakeKVNamespace();
            const keys = Array.from({ length: 101 }, (_, index) => `key-${ index }`);

            const values = await kv.get(keys.slice(0, 100));
            const caught = await catchAsyncError(() => kv.get(keys));

            assertEqual(100, values.size);
            assert(caught, 'expected 101 keys to reject');
            assertMatches('at most 100 keys', caught.message);
        });

        it('rejects the arrayBuffer and stream types', async () => {
            const kv = createFakeKVNamespace({ initial: { a: 'A' } });

            const arrayBuffer = await catchAsyncError(() => kv.get([ 'a' ], 'arrayBuffer'));
            const stream = await catchAsyncError(() => kv.get([ 'a' ], { type: 'stream' }));

            assert(arrayBuffer, 'expected the arrayBuffer type to reject');
            assertMatches('text and json', arrayBuffer.message);
            assert(stream, 'expected the stream type to reject');
            assertMatches('text and json', stream.message);
        });

        it('rejects an empty array', async () => {
            const kv = createFakeKVNamespace();

            const caught = await catchAsyncError(() => kv.get([]));

            assert(caught, 'expected the empty array to reject');
            assertEqual('TypeError', caught.name);
        });
    });

    describe('put', ({ it }) => {
        it('resolves undefined and replaces the value', async () => {
            const clock = makeClock();
            const kv = createFakeKVNamespace({ now: clock.now });

            const result = await kv.put('a', 'first');
            clock.advance(1000);
            await kv.put('a', 'second');

            assertUndefined(result);
            assertEqual('second', await kv.get('a'));
        });

        it('copies an ArrayBuffer, so later changes by the caller do not reach it', async () => {
            const kv = createFakeKVNamespace();
            const bytes = new Uint8Array([ 1, 2, 3 ]);

            await kv.put('a', bytes.buffer);
            bytes.fill(9);

            assertEqual('1,2,3', toBytes(await kv.get('a', 'arrayBuffer')));
        });

        it('copies exactly the bytes of a view', async () => {
            const kv = createFakeKVNamespace();
            const bytes = new Uint8Array([ 9, 8, 7, 6, 5, 4 ]);

            await kv.put('a', bytes.subarray(2, 4));
            await kv.put('b', new Uint8Array(bytes.buffer, 4, 2));
            bytes.fill(0);

            assertEqual('7,6', toBytes(await kv.get('a', 'arrayBuffer')));
            assertEqual('5,4', toBytes(await kv.get('b', 'arrayBuffer')));
        });

        it('rejects a value that is not a string, an ArrayBuffer, or a view with TypeError', async () => {
            const kv = createFakeKVNamespace();
            const stream = new ReadableStream();

            for (const value of [ 42, { n: 1 }, null, undefined, [ 1 ], stream ]) {
                const caught = await catchAsyncError(() => kv.put('a', value));

                assert(caught, `expected ${ Object.prototype.toString.call(value) } to reject`);
                assertEqual('TypeError', caught.name);
            }

            assertEqual(null, await kv.get('a'));
        });

        it('accepts a value of 25 MiB and rejects one byte more', async () => {
            const kv = createFakeKVNamespace();
            const bytes = new Uint8Array(MAX_VALUE_BYTES + 1);

            await kv.put('fits', bytes.subarray(0, MAX_VALUE_BYTES));
            const caught = await catchAsyncError(() => kv.put('too-large', bytes));
            const buffer = await catchAsyncError(() => kv.put('too-large', bytes.buffer));

            assertEqual(MAX_VALUE_BYTES, (await kv.get('fits', 'arrayBuffer')).byteLength);
            assert(caught, 'expected the large view to reject');
            assertMatches('26214400 bytes', caught.message);
            assert(buffer, 'expected the large ArrayBuffer to reject');
            assertEqual(null, await kv.get('too-large'));
        });

        it('measures a string value in UTF-8 bytes', async () => {
            const kv = createFakeKVNamespace();

            // Fewer characters than the limit, and two bytes more than it.
            const caught = await catchAsyncError(() => kv.put('a', 'é'.repeat((MAX_VALUE_BYTES / 2) + 1)));

            assert(caught, 'expected the large string to reject');
            assertMatches('26214400 bytes', caught.message);
        });

        it('accepts an expirationTtl of 60 and rejects 59', async () => {
            const kv = createFakeKVNamespace();

            await kv.put('a', 'value', { expirationTtl: 60 });
            const caught = await catchAsyncError(() => kv.put('b', 'value', { expirationTtl: 59 }));

            assertEqual('value', await kv.get('a'));
            assert(caught, 'expected an expirationTtl of 59 to reject');
            assertMatches('at least 60 seconds', caught.message);
            assertEqual(null, await kv.get('b'));
        });

        it('accepts an expiration 60 seconds away and rejects one 59 seconds away', async () => {
            const clock = makeClock();
            const kv = createFakeKVNamespace({ now: clock.now });
            const nowSeconds = START / 1000;

            await kv.put('a', 'value', { expiration: nowSeconds + 60 });
            const caught = await catchAsyncError(() => kv.put('b', 'value', { expiration: nowSeconds + 59 }));

            assertEqual('value', await kv.get('a'));
            assert(caught, 'expected the near expiration to reject');
            assertMatches('at least 60 seconds in the future', caught.message);
            assertEqual(null, await kv.get('b'));
        });

        it('measures the distance to an expiration in milliseconds', async () => {
            const clock = makeClock();
            const kv = createFakeKVNamespace({ now: clock.now });
            clock.advance(1);

            // 59.999 seconds away.
            const caught = await catchAsyncError(() => kv.put('a', 'value', { expiration: (START / 1000) + 60 }));

            assert(caught, 'expected the near expiration to reject');
        });

        it('rejects both expiration and expirationTtl', async () => {
            const kv = createFakeKVNamespace({ now: makeClock().now });

            const caught = await catchAsyncError(() => kv.put('a', 'value', { expiration: (START / 1000) + 60, expirationTtl: 60 }));

            assert(caught, 'expected the put to reject');
            assertEqual('TypeError', caught.name);
        });

        it('accepts metadata of 1,024 bytes as JSON and rejects 1,025', async () => {
            const kv = createFakeKVNamespace();

            // 511 two-byte characters and two quotes are 1,024 bytes.
            const largest = 'é'.repeat(511);

            await kv.put('a', 'value', { metadata: largest });
            const caught = await catchAsyncError(() => kv.put('b', 'value', { metadata: `${ largest }a` }));

            assertEqual('value', await kv.get('a'));
            assert(caught, 'expected the large metadata to reject');
            assertMatches('1024 bytes', caught.message);
            assertEqual(null, await kv.get('b'));
        });

        it('accepts metadata objects and rejects metadata that is not JSON', async () => {
            const kv = createFakeKVNamespace();

            await kv.put('a', 'value', { metadata: { owner: 'kris', tags: [ 'a' ] } });
            const caught = await catchAsyncError(() => kv.put('b', 'value', { metadata: () => {} }));

            assertEqual('value', await kv.get('a'));
            assert(caught, 'expected the function to reject');
            assertEqual('TypeError', caught.name);
        });

        it('rejects options of the wrong type with TypeError', async () => {
            const kv = createFakeKVNamespace();

            const results = [
                await catchAsyncError(() => kv.put('a', 'value', 60)),
                await catchAsyncError(() => kv.put('a', 'value', null)),
                await catchAsyncError(() => kv.put('a', 'value', { expirationTtl: '60' })),
                await catchAsyncError(() => kv.put('a', 'value', { expiration: new Date() })),
            ];

            for (const caught of results) {
                assert(caught, 'expected the put to reject');
                assertEqual('TypeError', caught.name);
            }
            assertEqual(null, await kv.get('a'));
        });
    });

    describe('the write rate', ({ it }) => {
        it('rejects a second put to a key at +999 ms and accepts one at +1,000 ms', async () => {
            const clock = makeClock();
            const kv = createFakeKVNamespace({ now: clock.now });

            await kv.put('a', 'first');
            clock.advance(999);
            const caught = await catchAsyncError(() => kv.put('a', 'second'));
            const afterRejection = await kv.get('a');
            clock.advance(1);
            await kv.put('a', 'third');

            assert(caught, 'expected the second put to reject');
            assertEqual('Error', caught.name);
            assertEqual('KV PUT failed: 429 Too Many Requests', caught.message);
            assertEqual('first', afterRejection);
            assertEqual('third', await kv.get('a'));
        });

        it('limits each key on its own', async () => {
            const kv = createFakeKVNamespace({ now: makeClock().now });

            await kv.put('a', 'value');
            await kv.put('b', 'value');

            assertEqual('value', await kv.get('b'));
        });

        it('does not count a put that was rejected for another reason', async () => {
            const kv = createFakeKVNamespace({ now: makeClock().now });

            await catchAsyncError(() => kv.put('a', 'value', { expirationTtl: 59 }));
            await kv.put('a', 'value');

            assertEqual('value', await kv.get('a'));
        });

        it('still limits a put that follows a delete', async () => {
            const clock = makeClock();
            const kv = createFakeKVNamespace({ now: clock.now });

            await kv.put('a', 'first');
            await kv.delete('a');
            const caught = await catchAsyncError(() => kv.put('a', 'second'));

            assert(caught, 'expected the put to reject');
            assertEqual('KV PUT failed: 429 Too Many Requests', caught.message);
        });
    });

    describe('delete', ({ it }) => {
        it('removes the value and resolves undefined', async () => {
            const kv = createFakeKVNamespace({ initial: { a: 'A' } });

            const result = await kv.delete('a');

            assertUndefined(result);
            assertEqual(null, await kv.get('a'));
        });

        it('resolves undefined for a missing key', async () => {
            const kv = createFakeKVNamespace();

            assertUndefined(await kv.delete('missing'));
        });
    });

    describe('expiry', ({ it }) => {
        it('hides a value once its expirationTtl has passed', async () => {
            const clock = makeClock();
            const kv = createFakeKVNamespace({ now: clock.now });

            await kv.put('a', 'value', { expirationTtl: 60 });
            clock.advance(59999);
            const before = await kv.get('a');
            clock.advance(1);

            assertEqual('value', before);
            assertEqual(null, await kv.get('a'));
            assertEqual(null, (await kv.get([ 'a' ])).get('a'));
        });

        it('hides a value once its expiration is reached', async () => {
            const clock = makeClock();
            const kv = createFakeKVNamespace({ now: clock.now });

            await kv.put('a', 'value', { expiration: (START / 1000) + 90 });
            clock.advance(89999);
            const before = await kv.get('a', 'arrayBuffer');
            clock.advance(1);

            assertEqual(5, before.byteLength);
            assertEqual(null, await kv.get('a', 'arrayBuffer'));
        });

        it('drops the expiration when the key is written again without one', async () => {
            const clock = makeClock();
            const kv = createFakeKVNamespace({ now: clock.now });

            await kv.put('a', 'first', { expirationTtl: 60 });
            clock.advance(1000);
            await kv.put('a', 'second');
            clock.advance(120000);

            assertEqual('second', await kv.get('a'));
        });

        it('accepts a new value for an expired key', async () => {
            const clock = makeClock();
            const kv = createFakeKVNamespace({ now: clock.now });

            await kv.put('a', 'first', { expirationTtl: 60 });
            clock.advance(60000);
            await kv.put('a', 'second');

            assertEqual('second', await kv.get('a'));
        });
    });

    describe('the default clock', ({ it }) => {
        it('reads Date.now() on every call', async () => {
            const tracker = new MockTracker();
            let time = START;
            tracker.method(Date, 'now', () => time);

            try {
                const kv = createFakeKVNamespace();

                await kv.put('a', 'first', { expirationTtl: 60 });
                const tooSoon = await catchAsyncError(() => kv.put('a', 'second'));
                time += 60000;

                assert(tooSoon, 'expected the second put to reject');
                assertEqual(null, await kv.get('a'));
            } finally {
                tracker.reset();
            }
        });
    });

    describe('what is not modeled', ({ it }) => {
        it('has no list() or getWithMetadata()', () => {
            const kv = createFakeKVNamespace();

            assertEqual('calls,delete,get,put', Object.keys(kv).sort().join(','));
            assertEqual('TypeError', catchError(() => kv.list()).name);
            assertEqual('TypeError', catchError(() => kv.getWithMetadata('a')).name);
        });
    });
});
