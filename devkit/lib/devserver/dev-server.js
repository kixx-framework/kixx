import fs from 'node:fs';
import http from 'node:http';
import { Buffer } from 'node:buffer';
import UsageError from '../usage-error.js';
import { isRestartTrigger } from './restart-trigger.js';


/**
 * The local development server: listens on the devserver port, proxies each
 * request to the current app server child, and marks the app changed when a
 * watched file changes. Shows an error page when the app is unavailable.
 */
export class DevServer {

    #projectDirectory;
    #port;
    #appProcess;
    #log;
    #watch;

    #server = null;
    #boundPort = null;
    #watcher = null;
    #isChangeLogged = false;
    #stopPromise = null;

    /**
     * @param {Object} args
     * @param {string} args.projectDirectory - Real (symlink-resolved) project directory to watch.
     * @param {number} args.port - Port to listen on; 0 picks a free port.
     * @param {import('./app-process.js').AppProcess} args.appProcess - Owns the app server child.
     * @param {function(string): void} args.log - Writes a devserver status line.
     * @param {function} [args.watch] - node:fs watch().
     */
    constructor(args) {
        const {
            projectDirectory,
            port,
            appProcess,
            log,
            watch = fs.watch,
        } = args ?? {};

        this.#projectDirectory = projectDirectory;
        this.#port = port;
        this.#appProcess = appProcess;
        this.#log = log;
        this.#watch = watch;
    }

    /**
     * The port the devserver is bound to, or null before start().
     * @type {number|null}
     */
    get port() {
        return this.#boundPort;
    }

    /**
     * Listens, starts watching, and begins starting the app server without
     * waiting for it, so startup errors show in the terminal right away.
     * @returns {Promise<void>}
     * @throws {UsageError} When the port is in use or not allowed.
     */
    async start() {
        const server = http.createServer((request, response) => {
            this.#handleRequest(request, response);
        });

        try {
            await new Promise((resolve, reject) => {
                server.once('error', reject);

                // All interfaces, matching node-server.js.
                server.listen(this.#port, () => {
                    server.off('error', reject);
                    resolve();
                });
            });
        } catch (cause) {
            if (cause.code === 'EADDRINUSE') {
                throw new UsageError(
                    `Port ${ this.#port } is already in use. Stop the other server or choose another port with --port.`,
                    { cause },
                );
            }

            if (cause.code === 'EACCES') {
                throw new UsageError(
                    `Port ${ this.#port } is not allowed (permission denied). Choose another port with --port.`,
                    { cause },
                );
            }

            throw cause;
        }

        server.on('error', (cause) => {
            this.#log(`server error: ${ cause.message }`);
        });

        this.#server = server;
        this.#boundPort = server.address().port;

        this.#startWatching();

        this.#ensureReady().catch((cause) => {
            this.#log(`unexpected error while starting the app server: ${ cause.message }`);
        });
    }

    /**
     * Stops watching, closes the server and its connections, and stops the
     * app server. Idempotent.
     * @returns {Promise<void>}
     */
    async stop() {
        if (!this.#stopPromise) {
            this.#stopPromise = this.#shutdown();
        }

        return await this.#stopPromise;
    }

    async #shutdown() {
        this.#closeWatcher();

        const closed = new Promise((resolve) => {
            if (this.#server) {
                this.#server.close(() => resolve());
                // In-flight and keep-alive sockets would otherwise hold the
                // process open after Ctrl-C.
                this.#server.closeAllConnections();
            } else {
                resolve();
            }
        });

        await Promise.all([ closed, this.#appProcess.stop() ]);
    }

    #startWatching() {
        try {
            this.#watcher = this.#watch(this.#projectDirectory, { recursive: true }, (_eventType, filename) => {
                this.#onFileChange(filename);
            });
        } catch (cause) {
            this.#warnWatchingStopped(cause);
            return;
        }

        this.#watcher.on('error', (cause) => {
            this.#warnWatchingStopped(cause);
            this.#closeWatcher();
        });
    }

    #onFileChange(filename) {
        if (!isRestartTrigger(filename)) {
            return;
        }

        this.#appProcess.markChanged();

        // Deno reports one save as several events; log the first only.
        if (!this.#isChangeLogged) {
            this.#isChangeLogged = true;
            this.#log(`change detected: ${ filename || '(unknown file)' }; restarting on next request`);
        }
    }

    #warnWatchingStopped(cause) {
        this.#log(
            `warning: file watching stopped (${ cause.message }); ` +
            'the app server now restarts only after a crash',
        );
    }

    #closeWatcher() {
        if (this.#watcher) {
            this.#watcher.close();
            this.#watcher = null;
        }
    }

    async #ensureReady() {
        const result = await this.#appProcess.ensureReady();
        this.#isChangeLogged = false;
        return result;
    }

    async #handleRequest(request, response) {
        try {
            const result = await this.#ensureReady();

            if (result.failure) {
                sendErrorPage(request, response, result.failure);
            } else {
                this.#proxy(request, response, result.port);
            }
        } catch (cause) {
            // ensureReady() does not reject for app failures; this guards
            // against a hung client if something unexpected does.
            this.#log(`unexpected error while handling a request: ${ cause.message }`);
            sendErrorPage(request, response, { reason: `devserver error: ${ cause.message }`, output: '' });
        }
    }

    #proxy(request, response, port) {
        // Forwarding request.headers unchanged keeps the client's Host header,
        // which virtual-hosts.js routes on; http.request() only adds a Host
        // header when none is given.
        const upstream = http.request({
            host: '127.0.0.1',
            port,
            method: request.method,
            path: request.url,
            headers: request.headers,
            // No pooled keep-alive socket may outlive a child restart.
            agent: false,
        }, (upstreamResponse) => {
            response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers);
            upstreamResponse.on('error', () => response.destroy());
            upstreamResponse.pipe(response);
        });

        upstream.on('error', (cause) => {
            // The output shows a crash's stack trace when the child died
            // mid-request.
            sendErrorPage(request, response, {
                reason: `connection to the app server failed: ${ cause.message }`,
                output: this.#appProcess.output,
            });
        });

        request.on('error', () => upstream.destroy());

        response.on('close', () => {
            if (!response.writableFinished) {
                upstream.destroy();
            }
        });

        request.pipe(upstream);
    }
}


function sendErrorPage(request, response, failure) {
    if (response.headersSent) {
        response.destroy();
        return;
    }

    const body = renderErrorPage(failure);

    response.writeHead(502, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
    });

    if (request.method === 'HEAD') {
        response.end();
    } else {
        response.end(body);
    }
}

function renderErrorPage(failure) {
    const output = failure.output ? escapeHtml(failure.output) : '(no output captured)';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>App server unavailable</title>
<style>
body { margin: 0; padding: 2rem; font-family: system-ui, sans-serif; color: #222; background: #fff; }
h1 { margin-top: 0; font-size: 1.5rem; color: #b00020; }
pre { padding: 1rem; overflow-x: auto; background: #f4f4f4; border: 1px solid #ddd; white-space: pre-wrap; }
</style>
</head>
<body>
<h1>App server unavailable</h1>
<p>${ escapeHtml(failure.reason) }</p>
<p>If the app failed to start, fix the error and save a file; the next request retries. Otherwise, reload.</p>
<pre>${ output }</pre>
</body>
</html>
`;
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
