import { describe } from 'kixx-test';
import { assert, assertEqual, assertArray } from 'kixx-assert';
import VirtualHost from '../../../lib/http-router/virtual-host.js';
import HttpRoute from '../../../lib/http-router/http-route.js';


function createMockRoute() {
    return {
        allowedMethods: [ 'GET' ],
        isMethodAllowed(method) {
            return method === 'GET';
        },
    };
}

function createRouteSpec(overrides = {}) {
    return {
        name: 'test-route',
        pattern: '/users',
        inboundMiddleware: [],
        outboundMiddleware: [],
        errorHandlers: [],
        targets: [
            { name: 'test-target', methods: [ 'GET' ], handlers: [], errorHandlers: [] },
        ],
        ...overrides,
    };
}


describe('VirtualHost constructor', ({ it }) => {
    const route1 = createMockRoute();
    const route2 = createMockRoute();

    const vhost = new VirtualHost({
        name: 'test-vhost',
        hostname: 'com.example.www',
        routes: [ route1, route2 ],
    });

    it('sets the name property', () => assertEqual('test-vhost', vhost.name));

    it('sets the routes property', () => {
        assertArray(vhost.routes);
        assertEqual(2, vhost.routes.length);
        assertEqual(route1, vhost.routes[0]);
        assertEqual(route2, vhost.routes[1]);
    });
});

describe('VirtualHost constructor when options.hostname and options.pattern are both not non-empty strings', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new VirtualHost({
                name: 'test-vhost',
                routes: [ createMockRoute() ],
            });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('VirtualHost constructor when options.routes is not an Array', ({ it }) => {
    it('throws an AssertionError', () => {
        let error;
        try {
            new VirtualHost({
                name: 'test-vhost',
                hostname: 'com.example.www',
                routes: null,
            });
        } catch (err) {
            error = err;
        }
        assertEqual('AssertionError', error.name);
        assertEqual('ASSERTION_ERROR', error.code);
    });
});

describe('VirtualHost#matchHostname() with wildcard hostname', ({ it }) => {
    const vhost = new VirtualHost({
        name: 'test-vhost',
        hostname: '*',
        routes: [ createMockRoute() ],
    });

    it('returns empty params for any hostname', () => {
        const params = vhost.matchHostname('www.example.com');
        assertEqual(0, Object.keys(params).length);
    });

    it('returns empty params for a different hostname', () => {
        const params = vhost.matchHostname('api.other.org');
        assertEqual(0, Object.keys(params).length);
    });
});

describe('VirtualHost#matchHostname() when the hostname matches exactly', ({ it }) => {
    // Hostnames are stored and matched in reversed format
    const vhost = new VirtualHost({
        name: 'test-vhost',
        hostname: 'com.example.www',
        routes: [ createMockRoute() ],
    });

    it('returns empty params', () => {
        const params = vhost.matchHostname('www.example.com');
        assertEqual(0, Object.keys(params).length);
    });
});

describe('VirtualHost#matchHostname() when the hostname does not match exactly', ({ it }) => {
    const vhost = new VirtualHost({
        name: 'test-vhost',
        hostname: 'com.example.www',
        routes: [ createMockRoute() ],
    });

    it('returns null', () => assertEqual(null, vhost.matchHostname('api.example.com')));
});

describe('VirtualHost#matchHostname() when the hostname matches a different TLD', ({ it }) => {
    const vhost = new VirtualHost({
        name: 'test-vhost',
        hostname: 'com.example.www',
        routes: [ createMockRoute() ],
    });

    it('returns null', () => assertEqual(null, vhost.matchHostname('www.example.org')));
});

describe('VirtualHost#matchHostname() with a pattern that matches', ({ it }) => {
    // Pattern matches against the reversed hostname (e.g., 'api.example.com' -> 'com.example.api')
    const vhost = new VirtualHost({
        name: 'test-vhost',
        pattern: 'com.example.:subdomain',
        routes: [ createMockRoute() ],
    });

    it('returns the extracted params', () => {
        const params = vhost.matchHostname('api.example.com');
        assertEqual('api', params.subdomain);
    });
});

describe('VirtualHost#matchHostname() with a pattern that does not match', ({ it }) => {
    const vhost = new VirtualHost({
        name: 'test-vhost',
        pattern: 'com.example.:subdomain',
        routes: [ createMockRoute() ],
    });

    it('returns null for a different domain', () => {
        assertEqual(null, vhost.matchHostname('api.other.com'));
    });

    it('returns null for a different TLD', () => {
        assertEqual(null, vhost.matchHostname('api.example.org'));
    });
});

describe('VirtualHost.fromSpecification()', ({ it }) => {
    const result = VirtualHost.fromSpecification(
        {
            name: 'example-vhost',
            hostname: 'com.example.www',
            routes: [ createRouteSpec() ],
        },
        new Map(),
        new Map(),
        new Map()
    );

    it('returns a VirtualHost instance', () => assert(result instanceof VirtualHost));

    it('sets the name from spec', () => assertEqual('example-vhost', result.name));

    it('creates routes from route specs', () => {
        assertArray(result.routes);
        assertEqual(1, result.routes.length);
        assert(result.routes[0] instanceof HttpRoute);
    });

    it('uses hostname for matching', () => {
        const params = result.matchHostname('www.example.com');
        assertEqual(0, Object.keys(params).length);
    });
});

describe('VirtualHost.fromSpecification() with a pattern spec', ({ it }) => {
    const result = VirtualHost.fromSpecification(
        {
            name: 'pattern-vhost',
            pattern: 'com.example.:subdomain',
            routes: [ createRouteSpec() ],
        },
        new Map(),
        new Map(),
        new Map()
    );

    it('returns a VirtualHost instance', () => assert(result instanceof VirtualHost));

    it('uses pattern for matching', () => {
        const params = result.matchHostname('api.example.com');
        assertEqual('api', params.subdomain);
    });
});
