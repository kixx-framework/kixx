import http from 'node:http';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, assertNotMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import { DevServer } from '../../../lib/devserver/dev-server.js';
import { canConnect, getFreePort } from '../../../lib/devserver/app-process.js';
import UsageError from '../../../lib/usage-error.js';


function makeFakeAppProcess(result, output) {
    return {
        output: output || '',
        ensureReadyCount: 0,
        markChangedCount: 0,
        stopCount: 0,
        async ensureReady() {
            this.ensureReadyCount += 1;
            return result;
        },
        markChanged() {
            this.markChangedCount += 1;
        },
        async stop() {
            this.stopCount += 1;
        },
    };
}

function makeFakeWatch() {
    const watcher = new EventEmitter();

    watcher.closeCount = 0;
    watcher.close = () => {
        watcher.closeCount += 1;
    };

    const watch = (directory, options, listener) => {
        watch.calls.push({ directory, options });
        watcher.emitChange = (filename) => listener('change', filename);
        return watcher;
    };

    watch.calls = [];
    watch.watcher = watcher;

    return watch;
}

async function startDevServer(appProcess, options) {
    const logs = [];
    const watch = makeFakeWatch();

    const devServer = new DevServer({
        projectDirectory: '/project',
        port: 0,
        appProcess,
        log: (message) => logs.push(message),
        watch,
        ...options,
    });

    await devServer.start();

    // Let the eager ensureReady() from start() resolve.
    await nextMacrotask();

    return { devServer, logs, watch };
}

function nextMacrotask() {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

function sendRequest(port, options) {
    const { method = 'GET', path = '/', headers = {}, body } = options ?? {};

    return new Promise((resolve, reject) => {
        const request = http.request({ host: '127.0.0.1', port, method, path, headers, agent: false }, (response) => {
            const chunks = [];

            response.setEncoding('utf8');
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                resolve({ statusCode: response.statusCode, headers: response.headers, body: chunks.join('') });
            });
        });

        request.on('error', reject);
        request.end(body);
    });
}

async function startUpstream(handler) {
    const server = http.createServer(handler);

    await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });

    return server;
}

function closeServer(server) {
    return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
    });
}


describe('DevServer', ({ describe }) => {

    describe('error page', ({ it }) => {
        it('escapes the reason and output and is never cached', async () => {
            const appProcess = makeFakeAppProcess({
                failure: { reason: 'exited <script>alert(1)</script> & "quit"', output: '<script>x</script> & \'y\'' },
            });
            const { devServer } = await startDevServer(appProcess);

            try {
                const response = await sendRequest(devServer.port);

                assertEqual(502, response.statusCode);
                assertEqual('text/html; charset=utf-8', response.headers['content-type']);
                assertEqual('no-store', response.headers['cache-control']);
                assertMatches('App server unavailable', response.body);
                assertMatches('exited &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quit&quot;', response.body);
                assertMatches('&lt;script&gt;x&lt;/script&gt; &amp; &#39;y&#39;', response.body);
                assertNotMatches('<script>', response.body);
                assertMatches('the next request retries', response.body);

                const head = await sendRequest(devServer.port, { method: 'HEAD' });

                assertEqual(502, head.statusCode);
                assertEqual('', head.body);
            } finally {
                await devServer.stop();
            }
        });

        it('shows a placeholder when no output was captured', async () => {
            const appProcess = makeFakeAppProcess({ failure: { reason: 'timed out', output: '' } });
            const { devServer } = await startDevServer(appProcess);

            try {
                const response = await sendRequest(devServer.port);

                assertMatches('(no output captured)', response.body);
            } finally {
                await devServer.stop();
            }
        });
    });

    describe('proxy', ({ it }) => {
        it('preserves the request and the response', async () => {
            const upstream = await startUpstream((request, response) => {
                const chunks = [];

                request.setEncoding('utf8');
                request.on('data', (chunk) => chunks.push(chunk));
                request.on('end', () => {
                    response.writeHead(201, {
                        'content-type': 'application/json',
                        'x-custom': 'yes',
                        'set-cookie': [ 'a=1; Path=/', 'b=2; Path=/' ],
                    });
                    response.end(JSON.stringify({
                        method: request.method,
                        url: request.url,
                        host: request.headers.host,
                        body: chunks.join(''),
                    }));
                });
            });

            const appProcess = makeFakeAppProcess({ port: upstream.address().port });
            const { devServer } = await startDevServer(appProcess);

            try {
                const response = await sendRequest(devServer.port, {
                    method: 'POST',
                    path: '/posts/new?draft=1&x=y',
                    headers: { host: 'blog.example.test', 'content-type': 'text/plain' },
                    body: 'hello world',
                });

                assertEqual(201, response.statusCode);
                assertEqual('yes', response.headers['x-custom']);
                assertEqual(JSON.stringify([ 'a=1; Path=/', 'b=2; Path=/' ]), JSON.stringify(response.headers['set-cookie']));
                assertEqual(JSON.stringify({
                    method: 'POST',
                    url: '/posts/new?draft=1&x=y',
                    host: 'blog.example.test',
                    body: 'hello world',
                }), response.body);
            } finally {
                await devServer.stop();
                await closeServer(upstream);
            }
        });

        it('shows the error page with the app output when the connection fails', async () => {
            const closedPort = await getFreePort();
            const appProcess = makeFakeAppProcess({ port: closedPort }, 'Error: boom\n    at handler');
            const { devServer } = await startDevServer(appProcess);

            try {
                const response = await sendRequest(devServer.port);

                assertEqual(502, response.statusCode);
                assertMatches('connection to the app server failed:', response.body);
                assertMatches('ECONNREFUSED', response.body);
                assertMatches('Error: boom\n    at handler', response.body);
            } finally {
                await devServer.stop();
            }
        });
    });

    describe('watching', ({ it }) => {
        it('marks the app changed for triggers and logs once per restart', async () => {
            const appProcess = makeFakeAppProcess({ failure: { reason: 'x', output: '' } });
            const { devServer, logs, watch } = await startDevServer(appProcess);

            const changeLogs = () => logs.filter((line) => line.startsWith('change detected'));

            try {
                assertEqual('/project', watch.calls[0].directory);
                assertEqual(true, watch.calls[0].options.recursive);

                watch.watcher.emitChange('app/foo.js');
                watch.watcher.emitChange('app/foo.js');

                assertEqual(2, appProcess.markChangedCount);
                assertEqual(1, changeLogs().length);
                assertEqual('change detected: app/foo.js; restarting on next request', changeLogs()[0]);

                watch.watcher.emitChange('pages/x.js');
                assertEqual(2, appProcess.markChangedCount);

                await sendRequest(devServer.port);

                watch.watcher.emitChange('node-config.jsonc');
                assertEqual(3, appProcess.markChangedCount);
                assertEqual(2, changeLogs().length);
            } finally {
                await devServer.stop();
            }
        });

        it('warns and keeps serving when the watcher fails', async () => {
            const appProcess = makeFakeAppProcess({ failure: { reason: 'still serving', output: '' } });
            const { devServer, logs, watch } = await startDevServer(appProcess);

            try {
                watch.watcher.emit('error', new Error('EMFILE: too many open files'));

                assert(logs.some((line) => line.startsWith('warning: file watching stopped (EMFILE')));
                assertEqual(1, watch.watcher.closeCount);

                const response = await sendRequest(devServer.port);

                assertMatches('still serving', response.body);
            } finally {
                await devServer.stop();
            }

            assertEqual(1, watch.watcher.closeCount);
        });
    });

    describe('start()', ({ it }) => {
        it('rejects with a UsageError when the port is taken', async () => {
            const blocker = net.createServer();

            await new Promise((resolve) => {
                blocker.listen(0, resolve);
            });

            const port = blocker.address().port;
            const appProcess = makeFakeAppProcess({ port: 1 });
            const watch = makeFakeWatch();

            const devServer = new DevServer({ projectDirectory: '/project', port, appProcess, log: () => {}, watch });

            let error;

            try {
                await devServer.start();
            } catch (cause) {
                error = cause;
            } finally {
                await new Promise((resolve) => {
                    blocker.close(resolve);
                });
            }

            assert(error instanceof UsageError, 'expected a UsageError');
            assertMatches(String(port), error.message);
            assertMatches('--port', error.message);
            assertEqual(0, appProcess.ensureReadyCount);
            assertEqual(0, watch.calls.length);
        });
    });

    describe('stop()', ({ it }) => {
        it('closes the server and watcher, stops the app, and is idempotent', async () => {
            const appProcess = makeFakeAppProcess({ failure: { reason: 'x', output: '' } });
            const { devServer, watch } = await startDevServer(appProcess);
            const port = devServer.port;

            assertEqual(1, appProcess.ensureReadyCount, 'start() begins the app server eagerly');
            assertEqual(true, await canConnect(port));

            await devServer.stop();
            await devServer.stop();

            assertEqual(false, await canConnect(port));
            assertEqual(1, watch.watcher.closeCount);
            assertEqual(1, appProcess.stopCount);
        });
    });
});
