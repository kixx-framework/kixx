import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import sinon from 'sinon';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches, isPlainObject } from 'kixx-assert';
import NodeServer from '../../../../lib/node/http-server/node-server.js';


function createMockNodeResponse() {
    const emitter = new EventEmitter();
    return {
        statusCode: 200,
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
        writeHead: sinon.fake(),
        end: sinon.fake(() => {
            // Simulate Node.js behavior: end() triggers 'finish'
            emitter.emit('finish');
        }),
    };
}

function createMockNodeRequest(overrides = {}) {
    const emitter = new EventEmitter();
    const defaults = {
        method: 'GET',
        url: '/test',
        headers: { host: 'localhost:8080' },
        complete: true,
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
    };
    return { ...defaults, ...overrides };
}

function createMockHttp(mockNodeServer) {
    return {
        createServer: sinon.fake.returns(mockNodeServer),
    };
}

function createMockNodeServer() {
    const emitter = new EventEmitter();
    return {
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
        listen: sinon.fake(() => {
            emitter.emit('listening');
        }),
        close: sinon.fake(() => {
            emitter.emit('close');
        }),
    };
}


// --- Constructor ---

describe('NodeServer#constructor() with no options', ({ it }) => {
    const server = new NodeServer();

    it('defaults port to 8080', () => {
        assertEqual(8080, server.port);
    });
});

describe('NodeServer#constructor() with custom port', ({ it }) => {
    const server = new NodeServer({ port: 3000 });

    it('sets port from options', () => {
        assertEqual(3000, server.port);
    });
});

describe('NodeServer#constructor() when port is NaN', ({ it }) => {
    const server = new NodeServer({ port: NaN });

    it('defaults port to 8080', () => {
        assertEqual(8080, server.port);
    });
});


// --- on() ---

describe('NodeServer#on() when event is emitted', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ http: mockHttp });
    let capturedEvent;

    before(() => {
        server.on('info', (ev) => {
            capturedEvent = ev;
        });
        server.startServer(() => {});
    });

    it('calls the listener with the event payload', () => {
        assert(isPlainObject(capturedEvent));
        assertEqual('server-listening', capturedEvent.name);
    });
});


// --- close() ---

describe('NodeServer#close() when server has not been started', ({ it }) => {
    const server = new NodeServer();

    it('throws AssertionError', () => {
        try {
            server.close();
        } catch (error) {
            assertEqual('AssertionError', error.name);
            assertMatches('Server has not been started', error.message);
            return;
        }
        throw new Error('Expected close() to throw');
    });
});

describe('NodeServer#close() when server has been started', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ port: 9090, http: mockHttp });
    let capturedEvent;

    before(() => {
        server.on('info', (ev) => {
            if (ev.name === 'server-closed') {
                capturedEvent = ev;
            }
        });
        server.startServer(() => {});
        server.close();
    });

    it('calls close on the underlying server', () => {
        assertEqual(1, mockNodeServer.close.callCount);
    });

    it('emits server-closed info event', () => {
        assert(isPlainObject(capturedEvent));
        assertEqual('server-closed', capturedEvent.name);
        assertEqual('server closed', capturedEvent.message);
        assertEqual(9090, capturedEvent.info.port);
    });
});


// --- startServer() ---

describe('NodeServer#startServer() when called', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ port: 4000, http: mockHttp });
    let capturedEvent;

    before(() => {
        server.on('info', (ev) => {
            capturedEvent = ev;
        });
        server.startServer(() => {});
    });

    it('creates an http server', () => {
        assertEqual(1, mockHttp.createServer.callCount);
    });

    it('calls listen with the configured port', () => {
        assertEqual(1, mockNodeServer.listen.callCount);
        assertEqual(4000, mockNodeServer.listen.firstCall.firstArg);
    });

    it('emits server-listening info event', () => {
        assert(isPlainObject(capturedEvent));
        assertEqual('server-listening', capturedEvent.name);
        assertEqual('http server listening', capturedEvent.message);
        assertEqual(4000, capturedEvent.info.port);
    });
});

describe('NodeServer#startServer() when already started', ({ it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ http: mockHttp });
    server.startServer(() => {});

    it('throws AssertionError', () => {
        try {
            server.startServer(() => {});
        } catch (error) {
            assertEqual('AssertionError', error.name);
            assertMatches('Server already started', error.message);
            return;
        }
        throw new Error('Expected startServer() to throw');
    });
});

describe('NodeServer#startServer() when underlying server emits error', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    // Prevent listen from auto-emitting 'listening'
    mockNodeServer.listen = sinon.fake();
    const server = new NodeServer({ port: 5000, http: mockHttp });
    const testError = new Error('EADDRINUSE');
    let capturedEvent;

    before(() => {
        server.on('error', (ev) => {
            capturedEvent = ev;
        });
        server.startServer(() => {});
        mockNodeServer.emit('error', testError);
    });

    it('emits server-error with fatal true', () => {
        assert(isPlainObject(capturedEvent));
        assertEqual('server-error', capturedEvent.name);
        assertEqual(true, capturedEvent.fatal);
        assertEqual(testError, capturedEvent.cause);
        assertEqual(5000, capturedEvent.info.port);
    });
});


// --- Request handling: sync handler ---

describe('NodeServer request handling with sync handler', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ port: 8080, http: mockHttp });

    const debugEvents = [];
    let handlerRequest;
    let handlerResponse;

    before(() => {
        server.on('debug', (ev) => {
            debugEvents.push(ev);
        });

        const handler = (req, res) => {
            handlerRequest = req;
            handlerResponse = res;
            res.status = 201;
            res.headers.set('content-type', 'text/plain; charset=utf-8');
            res.body = 'Created';
        };

        server.startServer(handler);

        // Invoke the request handler registered with createServer
        const requestHandler = mockHttp.createServer.firstCall.firstArg;
        const nodeRequest = createMockNodeRequest({ method: 'POST', url: '/items' });
        const nodeResponse = createMockNodeResponse();
        requestHandler(nodeRequest, nodeResponse);
    });

    it('emits request-received debug event', () => {
        const ev = debugEvents.find((e) => e.name === 'request-received');
        assert(isPlainObject(ev));
        assertEqual('POST', ev.info.method);
        assertMatches('/items', ev.info.url);
    });

    it('passes ServerRequest to handler', () => {
        assertEqual('req-1', handlerRequest.id);
        assertEqual('POST', handlerRequest.method);
    });

    it('passes ServerResponse to handler', () => {
        assertEqual('req-1', handlerResponse.id);
    });

    it('emits response-sent debug event', () => {
        const ev = debugEvents.find((e) => e.name === 'response-sent');
        assert(isPlainObject(ev));
        assertEqual('POST', ev.info.method);
    });
});

describe('NodeServer request handling writes correct response', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ http: mockHttp });
    let nodeResponse;

    before(() => {
        const handler = (req, res) => {
            res.status = 201;
            res.headers.set('content-type', 'text/plain; charset=utf-8');
            res.body = 'Created';
        };

        server.startServer(handler);

        const requestHandler = mockHttp.createServer.firstCall.firstArg;
        const nodeRequest = createMockNodeRequest({ method: 'POST', url: '/items' });
        nodeResponse = createMockNodeResponse();
        requestHandler(nodeRequest, nodeResponse);
    });

    it('writes status and headers via writeHead', () => {
        assertEqual(1, nodeResponse.writeHead.callCount);
        assertEqual(201, nodeResponse.writeHead.firstCall.args[0]);
    });

    it('writes string body via end()', () => {
        assertEqual(1, nodeResponse.end.callCount);
        assertEqual('Created', nodeResponse.end.firstCall.firstArg);
    });
});


// --- Request handling: async handler ---

describe('NodeServer request handling with async handler', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ http: mockHttp });
    let nodeResponse;

    before(async () => {
        const handler = async (req, res) => {
            res.status = 200;
            res.body = 'OK';
        };

        server.startServer(handler);

        const requestHandler = mockHttp.createServer.firstCall.firstArg;
        const nodeRequest = createMockNodeRequest();
        nodeResponse = createMockNodeResponse();

        // The handler is async, so we need to wait for it to resolve.
        // Invoke and wait a microtask for the promise chain to settle.
        requestHandler(nodeRequest, nodeResponse);
        await new Promise((resolve) => {
            setTimeout(resolve, 10);
        });
    });

    it('writes the response after handler resolves', () => {
        assertEqual(1, nodeResponse.writeHead.callCount);
        assertEqual(200, nodeResponse.writeHead.firstCall.args[0]);
        assertEqual('OK', nodeResponse.end.firstCall.firstArg);
    });
});


// --- Request handling: sync handler throws ---

describe('NodeServer request handling when sync handler throws', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ http: mockHttp });
    const testError = new Error('handler boom');
    let capturedError;
    let nodeResponse;

    before(() => {
        server.on('error', (ev) => {
            capturedError = ev;
        });

        const handler = () => {
            throw testError;
        };

        server.startServer(handler);

        const requestHandler = mockHttp.createServer.firstCall.firstArg;
        const nodeRequest = createMockNodeRequest();
        nodeResponse = createMockNodeResponse();
        requestHandler(nodeRequest, nodeResponse);
    });

    it('emits request-handler-error event', () => {
        assert(isPlainObject(capturedError));
        assertEqual('request-handler-error', capturedError.name);
        assertEqual(true, capturedError.fatal);
        assertEqual(testError, capturedError.cause);
    });

    it('sends 500 response', () => {
        assertEqual(500, nodeResponse.writeHead.firstCall.args[0]);
    });

    it('sends generic error body', () => {
        assertEqual('Internal server error.\n', nodeResponse.end.firstCall.firstArg);
    });
});


// --- Request handling: async handler rejects ---

describe('NodeServer request handling when async handler rejects', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ http: mockHttp });
    const testError = new Error('async boom');
    let capturedError;
    let nodeResponse;

    before(async () => {
        server.on('error', (ev) => {
            capturedError = ev;
        });

        const handler = async () => {
            throw testError;
        };

        server.startServer(handler);

        const requestHandler = mockHttp.createServer.firstCall.firstArg;
        const nodeRequest = createMockNodeRequest();
        nodeResponse = createMockNodeResponse();
        requestHandler(nodeRequest, nodeResponse);
        await new Promise((resolve) => {
            setTimeout(resolve, 10);
        });
    });

    it('emits request-handler-error event', () => {
        assert(isPlainObject(capturedError));
        assertEqual('request-handler-error', capturedError.name);
        assertEqual(testError, capturedError.cause);
    });

    it('sends 500 response', () => {
        assertEqual(500, nodeResponse.writeHead.firstCall.args[0]);
    });
});


// --- Request handling: request stream error ---

describe('NodeServer request handling when request emits error', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ http: mockHttp });
    const testError = new Error('stream error');
    let capturedError;

    before(() => {
        server.on('error', (ev) => {
            capturedError = ev;
        });

        server.startServer(() => {});

        const requestHandler = mockHttp.createServer.firstCall.firstArg;
        const nodeRequest = createMockNodeRequest();
        const nodeResponse = createMockNodeResponse();
        requestHandler(nodeRequest, nodeResponse);
        nodeRequest.emit('error', testError);
    });

    it('emits request-error event with fatal false', () => {
        assert(isPlainObject(capturedError));
        assertEqual('request-error', capturedError.name);
        assertEqual(false, capturedError.fatal);
        assertEqual(testError, capturedError.cause);
    });
});


// --- Request handling: request not complete (draining) ---

describe('NodeServer request handling when request is not complete', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ http: mockHttp });
    let nodeResponse;

    before(() => {
        server.startServer(() => {});

        const requestHandler = mockHttp.createServer.firstCall.firstArg;
        const nodeRequest = createMockNodeRequest({ complete: false });
        nodeResponse = createMockNodeResponse();
        requestHandler(nodeRequest, nodeResponse);

        // Simulate draining: emit 'end' after the data listener is attached
        nodeRequest.emit('end');
    });

    it('waits for drain then writes response', () => {
        assertEqual(1, nodeResponse.writeHead.callCount);
    });
});


// --- Response writing: null body ---

describe('NodeServer response writing when body is null', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ http: mockHttp });
    let nodeResponse;

    before(() => {
        const handler = (req, res) => {
            res.status = 204;
            res.body = null;
        };

        server.startServer(handler);

        const requestHandler = mockHttp.createServer.firstCall.firstArg;
        const nodeRequest = createMockNodeRequest();
        nodeResponse = createMockNodeResponse();
        requestHandler(nodeRequest, nodeResponse);
    });

    it('calls end() with no arguments', () => {
        assertEqual(1, nodeResponse.end.callCount);
        assertEqual(undefined, nodeResponse.end.firstCall.firstArg);
    });
});

describe('NodeServer response writing when body is Buffer', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ http: mockHttp });
    const bodyBuffer = Buffer.from('binary data');
    let nodeResponse;

    before(() => {
        const handler = (req, res) => {
            res.status = 200;
            res.body = bodyBuffer;
        };

        server.startServer(handler);

        const requestHandler = mockHttp.createServer.firstCall.firstArg;
        const nodeRequest = createMockNodeRequest();
        nodeResponse = createMockNodeResponse();
        requestHandler(nodeRequest, nodeResponse);
    });

    it('calls end() with the buffer', () => {
        assertEqual(bodyBuffer, nodeResponse.end.firstCall.firstArg);
    });
});

describe('NodeServer response writing when body is Node.js Readable', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ http: mockHttp });
    let piped = false;

    before(() => {
        const readable = new PassThrough();

        const handler = (req, res) => {
            res.status = 200;
            res.body = readable;
        };

        server.startServer(handler);

        const requestHandler = mockHttp.createServer.firstCall.firstArg;
        const nodeRequest = createMockNodeRequest();
        // Use a PassThrough as the response to detect piping
        const nodeResponse = new PassThrough();
        nodeResponse.writeHead = sinon.fake();
        nodeResponse.statusCode = 200;
        nodeResponse.on('pipe', () => {
            piped = true;
        });
        requestHandler(nodeRequest, nodeResponse);
    });

    it('pipes the readable stream into the response', () => {
        assertEqual(true, piped);
    });
});

describe('NodeServer response writing when method is HEAD and body is null', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ http: mockHttp });
    let nodeResponse;

    before(() => {
        const handler = (req, res) => {
            res.status = 200;
            res.headers.set('content-length', '5');
            res.body = null;
        };

        server.startServer(handler);

        const requestHandler = mockHttp.createServer.firstCall.firstArg;
        const nodeRequest = createMockNodeRequest({ method: 'HEAD' });
        nodeResponse = createMockNodeResponse();
        requestHandler(nodeRequest, nodeResponse);
    });

    it('writes headers but ends with no body', () => {
        assertEqual(1, nodeResponse.writeHead.callCount);
        assertEqual(1, nodeResponse.end.callCount);
        assertEqual(undefined, nodeResponse.end.firstCall.firstArg);
    });
});

describe('NodeServer response writing when method is HEAD and body is a string', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ http: mockHttp });
    let nodeResponse;

    before(() => {
        const handler = (req, res) => {
            res.status = 200;
            res.headers.set('content-length', '5');
            res.body = 'Hello';
        };

        server.startServer(handler);

        const requestHandler = mockHttp.createServer.firstCall.firstArg;
        const nodeRequest = createMockNodeRequest({ method: 'HEAD' });
        nodeResponse = createMockNodeResponse();
        requestHandler(nodeRequest, nodeResponse);
    });

    it('writes headers', () => {
        assertEqual(1, nodeResponse.writeHead.callCount);
    });

    it('does not write body or end the response', () => {
        // When body is non-null but method is HEAD, the current implementation
        // skips body writing but does not call end() either.
        assertEqual(0, nodeResponse.end.callCount);
    });
});


// --- Protocol and host detection ---

describe('NodeServer request URL when x-forwarded-proto and x-forwarded-host are set', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ http: mockHttp });
    let capturedUrl;

    before(() => {
        const handler = (req) => {
            capturedUrl = req.url;
        };

        server.startServer(handler);

        const requestHandler = mockHttp.createServer.firstCall.firstArg;
        const nodeRequest = createMockNodeRequest({
            url: '/path',
            headers: {
                'x-forwarded-proto': 'https',
                'x-forwarded-host': 'example.com',
                host: 'internal:8080',
            },
        });
        const nodeResponse = createMockNodeResponse();
        requestHandler(nodeRequest, nodeResponse);
    });

    it('uses forwarded protocol and host', () => {
        assertEqual('https://example.com/path', capturedUrl.href);
    });
});

describe('NodeServer request URL when no forwarding headers are set', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ http: mockHttp });
    let capturedUrl;

    before(() => {
        const handler = (req) => {
            capturedUrl = req.url;
        };

        server.startServer(handler);

        const requestHandler = mockHttp.createServer.firstCall.firstArg;
        const nodeRequest = createMockNodeRequest({
            url: '/path',
            headers: { host: 'myhost:3000' },
        });
        const nodeResponse = createMockNodeResponse();
        requestHandler(nodeRequest, nodeResponse);
    });

    it('falls back to http protocol and host header', () => {
        assertEqual('http://myhost:3000/path', capturedUrl.href);
    });
});

describe('NodeServer request URL when no host headers are present', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ http: mockHttp });
    let capturedUrl;

    before(() => {
        const handler = (req) => {
            capturedUrl = req.url;
        };

        server.startServer(handler);

        const requestHandler = mockHttp.createServer.firstCall.firstArg;
        const nodeRequest = createMockNodeRequest({
            url: '/path',
            headers: {},
        });
        const nodeResponse = createMockNodeResponse();
        requestHandler(nodeRequest, nodeResponse);
    });

    it('falls back to localhost', () => {
        assertEqual('http://localhost/path', capturedUrl.href);
    });
});


// --- Request ID generation ---

describe('NodeServer request ID increments across requests', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ http: mockHttp });
    const ids = [];

    before(() => {
        const handler = (req) => {
            ids.push(req.id);
        };

        server.startServer(handler);

        const requestHandler = mockHttp.createServer.firstCall.firstArg;

        for (let i = 0; i < 3; i += 1) {
            const nodeRequest = createMockNodeRequest();
            const nodeResponse = createMockNodeResponse();
            requestHandler(nodeRequest, nodeResponse);
        }
    });

    it('generates sequential IDs', () => {
        assertEqual('req-1', ids[0]);
        assertEqual('req-2', ids[1]);
        assertEqual('req-3', ids[2]);
    });
});


// --- Response headers preserve Set-Cookie ---

describe('NodeServer response writing preserves multiple Set-Cookie headers', ({ before, it }) => {
    const mockNodeServer = createMockNodeServer();
    const mockHttp = createMockHttp(mockNodeServer);
    const server = new NodeServer({ http: mockHttp });
    let nodeResponse;

    before(() => {
        const handler = (req, res) => {
            res.status = 200;
            res.headers.append('set-cookie', 'a=1');
            res.headers.append('set-cookie', 'b=2');
            res.body = 'OK';
        };

        server.startServer(handler);

        const requestHandler = mockHttp.createServer.firstCall.firstArg;
        const nodeRequest = createMockNodeRequest();
        nodeResponse = createMockNodeResponse();
        requestHandler(nodeRequest, nodeResponse);
    });

    it('passes headers as entries array to writeHead', () => {
        const headers = nodeResponse.writeHead.firstCall.args[1];
        const cookieEntries = headers.filter((entry) => entry[0] === 'set-cookie');
        assertEqual(2, cookieEntries.length);
        assertEqual('a=1', cookieEntries[0][1]);
        assertEqual('b=2', cookieEntries[1][1]);
    });
});
