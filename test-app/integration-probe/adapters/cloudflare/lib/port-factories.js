// Builds the subject of each port's conformance suite from the Cloudflare
// adapters, for the probe. Each factory is built the way the adapter's own
// unit test builds its own, over the Worker's real bindings.
import ContentStore from '../../../../../kixx/adapters/cloudflare/content-store/lib/content-store.js';
import LoggerWriter from '../../../../../kixx/adapters/cloudflare/logger-writer/lib/logger-writer.js';
import ServerRequest from '../../../../../kixx/adapters/cloudflare/server-request/lib/server-request.js';
import Logger from '../../../../../kixx/logger/logger.js';


// Workers KV allows one write per second to a key.
const KV_WRITE_WAIT_MILLISECONDS = 1100;

const ORIGIN = 'https://www.example.com';


/**
 * Returns a factory builder for each port suite. A builder takes the
 * request's context and returns the factory the suite calls. The probe calls
 * a builder on every run request, so a builder touches no binding: that
 * happens in the factory, or in the store it returns.
 *
 * @param {Object} options
 * @param {function(number): Promise<void>} options.wait - Resolves after a number of milliseconds
 * @param {function(): string} options.createId - Returns a new unique id on each call
 * @returns {Object<string, Function>} Builders, by suite name
 */
export function createPortFactories({ wait, createId }) {
    return {
        // The app's own store and namespace: the suite's keys are unique to
        // each test.
        'key-value-store': (context) => () => ({
            store: context.getService('KeyValueStore'),
            context,
            afterWrite: () => wait(KV_WRITE_WAIT_MILLISECONDS),
        }),

        // The app's own bindings under a wire format of its own, which
        // names a Durable Object instance and a set of KV keys no other
        // test and no page request shares. The store has no delete: each
        // test leaves that instance and those keys behind.
        'content-store': (context) => () => {
            const storeConfig = context.config.env.CONTENT_STORE;

            return {
                store: new ContentStore({
                    logger: createStoreLogger(context),
                    kvBindingName: storeConfig.kvNamespace.bindingName,
                    durableObjectBindingName: storeConfig.durableObject.bindingName,
                    wireFormat: `probe-${ createId() }`,
                    blobReadCacheTtlSeconds: storeConfig.blobReadCacheTtlSeconds,
                    // The suite reads back what it just wrote.
                    indexCacheTtlSeconds: 0,
                    scheduler: { wait },
                }),
                context,
                createStoreWithoutLogger: () => new ContentStore({}),
            };
        },

        // Never the real console: it carries the Worker's own logs.
        'logger-writer': () => () => {
            const lines = [];
            const sink = {};

            for (const method of [ 'debug', 'info', 'warn', 'error' ]) {
                sink[method] = (line) => {
                    lines.push(line);
                };
            }

            return {
                writer: new LoggerWriter({ console: sink }),
                lines: () => lines.slice(),
            };
        },

        // Workers needs an absolute URL.
        'server-request': () => ({ method = 'GET', path = '/', headers = {}, body } = {}) => {
            const init = { method, headers };

            // A GET or HEAD request can't carry a body.
            if (body !== undefined) {
                init.body = body;
            }

            return new ServerRequest(new Request(`${ ORIGIN }${ path }`, init));
        },
    };
}

// A store builds a child of the logger it is given, and the app's logger
// takes no new child once boot is over. So a store built during a request
// gets a root logger of its own, at the app's level.
function createStoreLogger(context) {
    return new Logger({ name: 'integration-probe', level: context.logger.level });
}
