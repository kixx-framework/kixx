import { Readable } from 'node:stream';
import { describe } from 'kixx-test';
import { assertEqual, assertMatches } from 'kixx-assert';
import ServerResponse from '../../../lib/node-http-server/server-response.js';


describe('ServerResponse constructor', ({ it }) => {
    const response = new ServerResponse('resp-123');

    it('sets id from constructor argument', () => assertEqual('resp-123', response.id));
    it('sets status to 200', () => assertEqual(200, response.status));
    it('sets body to null', () => assertEqual(null, response.body));
    it('exposes headers as Web API Headers', () => {
        assertEqual('Headers', response.headers?.constructor?.name);
    });
});

describe('ServerResponse#props', ({ it }) => {
    const response = new ServerResponse('resp-1');

    it('returns mutable object', () => {
        response.props.foo = 'bar';
        assertEqual('bar', response.props.foo);
    });
});

describe('ServerResponse#updateProps()', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.props.a = 1;

    it('deep merges params into props and returns this', () => {
        const result = response.updateProps({ b: 2 });
        assertEqual(response, result);
        assertEqual(1, response.props.a);
        assertEqual(2, response.props.b);
    });
});

describe('ServerResponse#updateProps() when merge fails', ({ it }) => {
    const response = new ServerResponse('resp-1');

    it('throws WrappedError', () => {
        let error;
        try {
            response.updateProps({ fn: function notCloneable() {} });
        } catch (err) {
            error = err;
        }
        assertEqual('WrappedError', error.name);
        assertMatches('Cannot clone and merge response props', error.message);
    });
});

describe('ServerResponse#setHeader()', ({ it }) => {
    const response = new ServerResponse('resp-1');

    it('sets header and returns this', () => {
        const result = response.setHeader('x-custom', 'value');
        assertEqual(response, result);
        assertEqual('value', response.headers.get('x-custom'));
    });
});

describe('ServerResponse#appendHeader()', ({ it }) => {
    const response = new ServerResponse('resp-1');

    it('appends header and returns this', () => {
        const result = response.appendHeader('set-cookie', 'a=1').appendHeader('set-cookie', 'b=2');
        assertEqual(response, result);
        const cookies = response.headers.getSetCookie();
        assertEqual(2, cookies.length);
        assertEqual('a=1', cookies[0]);
        assertEqual('b=2', cookies[1]);
    });
});

describe('ServerResponse#setCookie() with minimal args', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.setCookie('session', 'abc123');

    it('sets cookie with Secure and HttpOnly and SameSite=Lax', () => {
        const cookies = response.headers.getSetCookie();
        assertEqual(1, cookies.length);
        assertEqual(true, cookies[0].includes('session='));
        assertEqual(true, cookies[0].includes('Secure'));
        assertEqual(true, cookies[0].includes('HttpOnly'));
        assertEqual(true, cookies[0].includes('SameSite=Lax'));
    });
});

describe('ServerResponse#setCookie() with options', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.setCookie('session', 'xyz', {
        maxAge: 3600,
        domain: '.example.com',
        path: '/admin',
        sameSite: 'Strict',
    });

    it('includes Max-Age, Domain, Path, SameSite', () => {
        const cookie = response.headers.getSetCookie()[0];
        assertEqual(true, cookie.includes('Max-Age=3600'));
        assertEqual(true, cookie.includes('Domain=.example.com'));
        assertEqual(true, cookie.includes('Path=/admin'));
        assertEqual(true, cookie.includes('SameSite=Strict'));
    });
});

describe('ServerResponse#setCookie() when secure is false', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.setCookie('session', 'val', { secure: false });

    it('omits Secure from cookie', () => {
        const cookie = response.headers.getSetCookie()[0];
        assertEqual(false, cookie.includes('Secure'));
    });
});

describe('ServerResponse#setCookie() when httpOnly is false', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.setCookie('theme', 'dark', { httpOnly: false });

    it('omits HttpOnly from cookie', () => {
        const cookie = response.headers.getSetCookie()[0];
        assertEqual(false, cookie.includes('HttpOnly'));
    });
});

describe('ServerResponse#setCookie() encodes value', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.setCookie('data', 'a=b&c=d');

    it('uses encodeURIComponent on value', () => {
        const cookie = response.headers.getSetCookie()[0];
        assertEqual(true, cookie.startsWith('data=a%3Db%26c%3Dd'));
    });
});

describe('ServerResponse#clearCookie()', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.clearCookie('session', { path: '/app' });

    it('sets cookie with empty value and Max-Age=0', () => {
        const cookie = response.headers.getSetCookie()[0];
        assertEqual(true, cookie.includes('session='));
        assertEqual(true, cookie.includes('Max-Age=0'));
        assertEqual(true, cookie.includes('Path=/app'));
    });
});

describe('ServerResponse#clearCookie() when path not provided', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.clearCookie('session');

    it('uses default path /', () => {
        const cookie = response.headers.getSetCookie()[0];
        assertEqual(true, cookie.includes('Path=/'));
    });
});

describe('ServerResponse#respond() with status only', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.respond(201);

    it('sets status', () => assertEqual(201, response.status));
});

describe('ServerResponse#respond() with status and body', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.respond(200, null, 'Hello');

    it('sets status and body', () => {
        assertEqual(200, response.status);
        assertEqual('Hello', response.body);
    });
});

describe('ServerResponse#respond() with headers object', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.respond(200, { 'x-request-id': 'req-1' });

    it('applies headers', () => assertEqual('req-1', response.headers.get('x-request-id')));
});

describe('ServerResponse#respond() with Headers instance', ({ it }) => {
    const response = new ServerResponse('resp-1');
    const headers = new Headers();
    headers.set('x-custom', 'val');
    response.respond(200, headers);

    it('applies headers', () => assertEqual('val', response.headers.get('x-custom')));
});

describe('ServerResponse#respond() with headers array', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.respond(200, [ [ 'x-foo', 'bar' ] ]);

    it('applies headers', () => assertEqual('bar', response.headers.get('x-foo')));
});

describe('ServerResponse#respondWithRedirect()', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.respondWithRedirect(302, 'https://example.com/login');

    it('sets status and Location header', () => {
        assertEqual(302, response.status);
        assertEqual('https://example.com/login', response.headers.get('location'));
    });
});

describe('ServerResponse#respondWithRedirect() with URL object', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.respondWithRedirect(307, new URL('https://example.com/redirect'));

    it('sets Location from url.href', () => {
        assertEqual(307, response.status);
        assertEqual('https://example.com/redirect', response.headers.get('location'));
    });
});

describe('ServerResponse#respondWithRedirect() with options.headers', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.respondWithRedirect(301, '/moved', { headers: { 'cache-control': 'no-store' } });

    it('applies additional headers', () => assertEqual('no-store', response.headers.get('cache-control')));
});

describe('ServerResponse#respondWithRedirect() when statusCode is not a number', ({ it }) => {
    const response = new ServerResponse('resp-1');

    it('throws AssertionError', () => {
        let error;
        try {
            response.respondWithRedirect('302', '/url');
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('ServerResponse#respondWithRedirect() when newLocation is empty string', ({ it }) => {
    const response = new ServerResponse('resp-1');

    it('throws AssertionError', () => {
        let error;
        try {
            response.respondWithRedirect(302, '');
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('ServerResponse#respondWithJSON()', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.respondWithJSON(200, { id: 1, name: 'test' });

    it('sets status, content-type, content-length, and body', () => {
        assertEqual(200, response.status);
        assertEqual('application/json; charset=utf-8', response.headers.get('content-type'));
        assertEqual(true, response.headers.has('content-length'));
        assertEqual(true, response.body.endsWith('\n'));
        assertEqual(true, response.body.includes('"id":1'));
        assertEqual(true, response.body.includes('"name":"test"'));
    });
});

describe('ServerResponse#respondWithJSON() with whiteSpace option', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.respondWithJSON(200, { a: 1 }, { whiteSpace: 2 });

    it('pretty-prints with 2 spaces', () => {
        assertEqual(true, response.body.includes('  "a": 1'));
    });
});

describe('ServerResponse#respondWithJSON() when statusCode is not a number', ({ it }) => {
    const response = new ServerResponse('resp-1');

    it('throws AssertionError', () => {
        let error;
        try {
            response.respondWithJSON(NaN, {});
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('ServerResponse#respondWithHTML()', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.respondWithHTML(200, '<html><body>Hi</body></html>');

    it('sets content-type text/html and body', () => {
        assertEqual(200, response.status);
        assertEqual('text/html; charset=utf-8', response.headers.get('content-type'));
        assertEqual('<html><body>Hi</body></html>', response.body);
    });
});

describe('ServerResponse#respondWithHTML() when utf8 is empty', ({ it }) => {
    const response = new ServerResponse('resp-1');

    it('throws AssertionError', () => {
        let error;
        try {
            response.respondWithHTML(200, '');
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('ServerResponse#respondWithUtf8()', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.respondWithUtf8(201, 'Plain text body');

    it('sets status, content-type, content-length, body', () => {
        assertEqual(201, response.status);
        assertEqual('text/plain; charset=utf-8', response.headers.get('content-type'));
        assertEqual('15', response.headers.get('content-length'));
        assertEqual('Plain text body', response.body);
    });
});

describe('ServerResponse#respondWithUtf8() with multi-byte UTF-8', ({ it }) => {
    const response = new ServerResponse('resp-1');
    const body = 'café'; // é is 2 bytes in UTF-8
    response.respondWithUtf8(200, body);

    it('sets content-length to byte length', () => {
        const expectedBytes = new Blob([ body ]).size;
        assertEqual(String(expectedBytes), response.headers.get('content-length'));
    });
});

describe('ServerResponse#respondWithUtf8() when utf8 is empty', ({ it }) => {
    const response = new ServerResponse('resp-1');

    it('throws AssertionError', () => {
        let error;
        try {
            response.respondWithUtf8(200, '');
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});

describe('ServerResponse#respondWithStream()', ({ it }) => {
    const response = new ServerResponse('resp-1');
    const stream = Readable.from([ 'chunk' ]);
    response.respondWithStream(200, stream, {
        contentType: 'application/octet-stream',
        contentLength: 5,
    });

    it('sets status, body, content-type, content-length', () => {
        assertEqual(200, response.status);
        assertEqual(stream, response.body);
        assertEqual('application/octet-stream', response.headers.get('content-type'));
        assertEqual('5', response.headers.get('content-length'));
    });
});

describe('ServerResponse#respondWithStream() with null stream', ({ it }) => {
    const response = new ServerResponse('resp-1');
    response.respondWithStream(204, null);

    it('sets status and null body', () => {
        assertEqual(204, response.status);
        assertEqual(null, response.body);
    });
});

describe('ServerResponse#respondWithStream() when statusCode is not a number', ({ it }) => {
    const response = new ServerResponse('resp-1');

    it('throws AssertionError', () => {
        let error;
        try {
            response.respondWithStream(NaN, Readable.from([]));
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
    });
});
