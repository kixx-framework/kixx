// Builds the subject of each port's conformance suite from the Node.js
// adapters, for the probe. Each factory is built the way the adapter's own
// unit test builds its own.
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';

import { FORMAT } from '../../../../../kixx/content-addressable-store/addressing.js';
import ContentStore from '../../../../../kixx/adapters/node/content-store/lib/content-store.js';
import LoggerWriter from '../../../../../kixx/adapters/node/logger-writer/lib/logger-writer.js';
import ServerRequest from '../../../../../kixx/adapters/node/server-request/lib/server-request.js';


// Under the data directory, one directory per content store test.
const CONTENT_STORE_DIRECTORY = 'integration-probe/content-store';


/**
 * Returns a factory builder for each port suite. A builder takes the
 * request's context and returns the factory the suite calls. The probe calls
 * a builder on every run request, so a builder touches no storage: that
 * happens in the factory.
 *
 * @param {Object} options
 * @param {function(string): string} options.resolveFilepath - The config's resolver: a path under the data directory
 * @param {function(): string} options.createId - Returns a new unique id on each call
 * @returns {Object<string, Function>} Builders, by suite name
 */
export function createPortFactories({ resolveFilepath, createId }) {
    return {
        // The app's own store: the suite's keys are unique to each test.
        // SQLite has no write limit to wait out.
        'key-value-store': (context) => () => ({
            store: context.getService('KeyValueStore'),
            context,
            async afterWrite() {},
        }),

        // A new, empty store for each test, in its own directory.
        'content-store': (context) => () => {
            const rootDirectory = resolveFilepath(`${ CONTENT_STORE_DIRECTORY }/${ createId() }`);

            return {
                store: new ContentStore({ logger: context.logger, rootDirectory, format: FORMAT }),
                context,
                createStoreWithoutLogger: () => new ContentStore({ rootDirectory, format: FORMAT }),
            };
        },

        // Never a process stream: those carry the server's own logs.
        'logger-writer': () => () => {
            const chunks = [];

            const stream = {
                write(chunk) {
                    chunks.push(chunk);
                    return true;
                },
            };

            return {
                writer: new LoggerWriter({ stdout: stream, stderr: stream }),
                lines: () => chunks.map((chunk) => chunk.replace(/\n$/, '')),
            };
        },

        'server-request': () => (options) => new ServerRequest(makeIncoming(options ?? {})),
    };
}

// Stands in for http.IncomingMessage: a stream of the body's bytes with the
// fields the adapter reads. Node.js lowercases header names.
function makeIncoming({ method = 'GET', path = '/', headers = {}, body }) {
    const lowercased = { host: 'www.example.com' };

    for (const [ key, value ] of Object.entries(headers)) {
        lowercased[key.toLowerCase()] = value;
    }

    const chunks = body === undefined ? [] : [ Buffer.from(body) ];

    // Frame the body so the adapter finds it, unless the caller framed it.
    if (
        body !== undefined
        && lowercased['content-length'] === undefined
        && lowercased['transfer-encoding'] === undefined
    ) {
        lowercased['content-length'] = String(chunks[0].byteLength);
    }

    const incoming = Readable.from(chunks);

    incoming.method = method;
    incoming.url = path;
    incoming.headers = lowercased;
    incoming.socket = { encrypted: false, remoteAddress: undefined };

    return incoming;
}
