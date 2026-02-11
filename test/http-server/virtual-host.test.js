import { describe } from 'kixx-test';
import { assert, assertEqual, assertArray } from 'kixx-assert';
import VirtualHost from '../../lib/http-server/virtual-host.js';
import HttpRoute from '../../lib/http-server/http-route.js';
import HttpTarget from '../../lib/http-server/http-target.js';


describe('VirtualHost#constructor with exact hostname', ({ before, it }) => {
    const name = 'test-vhost';
    const hostname = 'com.example.www';
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });
    const route1 = new HttpRoute({
        name: 'route1',
        pattern: '/test',
        targets: [ target ],
        errorHandlers: [],
    });
    const routes = [ route1 ];

    let vhost;

    before(() => {
        vhost = new VirtualHost({ name, hostname, routes });
    });

    it('sets the name property', () => {
        assertEqual(name, vhost.name);
    });

    it('sets the routes property', () => {
        assertEqual(1, vhost.routes.length);
        assertEqual(route1, vhost.routes[0]);
    });

    it('makes name enumerable', () => {
        const descriptor = Object.getOwnPropertyDescriptor(vhost, 'name');
        assertEqual(true, descriptor.enumerable);
    });

    it('makes routes enumerable', () => {
        const descriptor = Object.getOwnPropertyDescriptor(vhost, 'routes');
        assertEqual(true, descriptor.enumerable);
    });
});


describe('VirtualHost#constructor with wildcard hostname', ({ before, it }) => {
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });
    const route1 = new HttpRoute({
        name: 'route1',
        pattern: '/test',
        targets: [ target ],
        errorHandlers: [],
    });

    let vhost;

    before(() => {
        vhost = new VirtualHost({
            name: 'wildcard-vhost',
            hostname: '*',
            routes: [ route1 ],
        });
    });

    it('sets the name property', () => {
        assertEqual('wildcard-vhost', vhost.name);
    });

    it('sets the routes property', () => {
        assertEqual(1, vhost.routes.length);
    });
});


describe('VirtualHost#constructor with pattern', ({ before, it }) => {
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });
    const route1 = new HttpRoute({
        name: 'route1',
        pattern: '/test',
        targets: [ target ],
        errorHandlers: [],
    });

    let vhost;

    before(() => {
        vhost = new VirtualHost({
            name: 'pattern-vhost',
            pattern: 'com.example.:subdomain',
            routes: [ route1 ],
        });
    });

    it('sets the name property', () => {
        assertEqual('pattern-vhost', vhost.name);
    });

    it('sets the routes property', () => {
        assertEqual(1, vhost.routes.length);
    });
});


describe('VirtualHost#constructor without hostname or pattern', ({ before, it }) => {
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });
    const route1 = new HttpRoute({
        name: 'route1',
        pattern: '/test',
        targets: [ target ],
        errorHandlers: [],
    });

    let vhost;

    before(() => {
        vhost = new VirtualHost({
            name: 'no-hostname-vhost',
            routes: [ route1 ],
        });
    });

    it('sets the name property', () => {
        assertEqual('no-hostname-vhost', vhost.name);
    });

    it('sets the routes property', () => {
        assertEqual(1, vhost.routes.length);
    });
});


describe('VirtualHost#constructor makes name non-writable', ({ before, it }) => {
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });
    const route1 = new HttpRoute({
        name: 'route1',
        pattern: '/test',
        targets: [ target ],
        errorHandlers: [],
    });

    let vhost;

    before(() => {
        vhost = new VirtualHost({
            name: 'test-vhost',
            hostname: '*',
            routes: [ route1 ],
        });
    });

    it('throws TypeError when attempting to modify name', () => {
        let error;
        try {
            vhost.name = 'new-name';
        } catch (err) {
            error = err;
        }
        assertEqual('TypeError', error.name);
    });
});


describe('VirtualHost#constructor makes routes non-writable', ({ before, it }) => {
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });
    const route1 = new HttpRoute({
        name: 'route1',
        pattern: '/test',
        targets: [ target ],
        errorHandlers: [],
    });

    let vhost;

    before(() => {
        vhost = new VirtualHost({
            name: 'test-vhost',
            hostname: '*',
            routes: [ route1 ],
        });
    });

    it('throws TypeError when attempting to replace routes', () => {
        let error;
        try {
            vhost.routes = [];
        } catch (err) {
            error = err;
        }
        assertEqual('TypeError', error.name);
    });
});


describe('VirtualHost#matchHostname() with exact hostname match', ({ before, it }) => {
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });
    const route1 = new HttpRoute({
        name: 'route1',
        pattern: '/test',
        targets: [ target ],
        errorHandlers: [],
    });

    let vhost;
    let result;

    before(() => {
        // Note: hostname stored internally in reversed format
        vhost = new VirtualHost({
            name: 'test-vhost',
            hostname: 'com.example.www',
            routes: [ route1 ],
        });
        // Input should be in normal format (will be reversed internally)
        result = vhost.matchHostname('www.example.com');
    });

    it('returns an object', () => {
        assert(result);
        assertEqual('object', typeof result);
    });

    it('returns empty object for exact match', () => {
        assertEqual(0, Object.keys(result).length);
    });
});


describe('VirtualHost#matchHostname() with non-matching hostname', ({ before, it }) => {
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });
    const route1 = new HttpRoute({
        name: 'route1',
        pattern: '/test',
        targets: [ target ],
        errorHandlers: [],
    });

    let vhost;
    let result;

    before(() => {
        vhost = new VirtualHost({
            name: 'test-vhost',
            hostname: 'com.example.www',
            routes: [ route1 ],
        });
        result = vhost.matchHostname('api.example.com');
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('VirtualHost#matchHostname() with wildcard hostname', ({ before, it }) => {
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });
    const route1 = new HttpRoute({
        name: 'route1',
        pattern: '/test',
        targets: [ target ],
        errorHandlers: [],
    });

    let vhost;

    before(() => {
        vhost = new VirtualHost({
            name: 'wildcard-vhost',
            hostname: '*',
            routes: [ route1 ],
        });
    });

    it('matches any hostname', () => {
        const result1 = vhost.matchHostname('www.example.com');
        const result2 = vhost.matchHostname('api.example.com');
        const result3 = vhost.matchHostname('localhost');

        assert(result1);
        assert(result2);
        assert(result3);
    });

    it('returns empty object for wildcard match', () => {
        const result = vhost.matchHostname('anything.com');
        assertEqual('object', typeof result);
        assertEqual(0, Object.keys(result).length);
    });
});


describe('VirtualHost#matchHostname() with pattern', ({ before, it }) => {
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });
    const route1 = new HttpRoute({
        name: 'route1',
        pattern: '/test',
        targets: [ target ],
        errorHandlers: [],
    });

    let vhost;
    let result;

    before(() => {
        // Pattern in reversed format (com.example.:subdomain matches *.example.com)
        vhost = new VirtualHost({
            name: 'pattern-vhost',
            pattern: 'com.example.:subdomain',
            routes: [ route1 ],
        });
        result = vhost.matchHostname('api.example.com');
    });

    it('returns an object with params', () => {
        assert(result);
        assertEqual('object', typeof result);
    });

    it('extracts subdomain parameter', () => {
        assertEqual('api', result.subdomain);
    });
});


describe('VirtualHost#matchHostname() with pattern non-match', ({ before, it }) => {
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });
    const route1 = new HttpRoute({
        name: 'route1',
        pattern: '/test',
        targets: [ target ],
        errorHandlers: [],
    });

    let vhost;
    let result;

    before(() => {
        vhost = new VirtualHost({
            name: 'pattern-vhost',
            pattern: 'com.example.:subdomain',
            routes: [ route1 ],
        });
        result = vhost.matchHostname('www.different.com');
    });

    it('returns null', () => {
        assertEqual(null, result);
    });
});


describe('VirtualHost#matchHostname() reverses hostname internally', ({ before, it }) => {
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });
    const route1 = new HttpRoute({
        name: 'route1',
        pattern: '/test',
        targets: [ target ],
        errorHandlers: [],
    });

    let vhost;

    before(() => {
        // Hostname stored as reversed: com.example.api
        vhost = new VirtualHost({
            name: 'test-vhost',
            hostname: 'com.example.api',
            routes: [ route1 ],
        });
    });

    it('matches hostname provided in normal format', () => {
        // Input as normal format, will be reversed internally to match
        const result = vhost.matchHostname('api.example.com');
        assert(result);
    });

    it('does not match different hostname', () => {
        const result = vhost.matchHostname('www.example.com');
        assertEqual(null, result);
    });
});


describe('VirtualHost#matchHostname() with multiple pattern parameters', ({ before, it }) => {
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });
    const route1 = new HttpRoute({
        name: 'route1',
        pattern: '/test',
        targets: [ target ],
        errorHandlers: [],
    });

    let vhost;
    let result;

    before(() => {
        // Pattern: com.:domain.:subdomain (matches subdomain.domain.com)
        vhost = new VirtualHost({
            name: 'pattern-vhost',
            pattern: 'com.:domain.:subdomain',
            routes: [ route1 ],
        });
        result = vhost.matchHostname('api.example.com');
    });

    it('extracts all parameters', () => {
        assertEqual('example', result.domain);
        assertEqual('api', result.subdomain);
    });
});


describe('VirtualHost#matchRequest() with matching route', ({ before, it }) => {
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });
    const route1 = new HttpRoute({
        name: 'route1',
        pattern: '/users/:id',
        targets: [ target ],
        errorHandlers: [],
    });

    let vhost;
    let result;

    before(() => {
        vhost = new VirtualHost({
            name: 'test-vhost',
            hostname: '*',
            routes: [ route1 ],
        });
        result = vhost.matchRequest({
            url: { pathname: '/users/123' },
        });
    });

    it('returns an array', () => {
        assertArray(result);
    });

    it('returns array with 2 elements', () => {
        assertEqual(2, result.length);
    });

    it('returns the matching route as first element', () => {
        assertEqual(route1, result[0]);
    });

    it('returns path parameters as second element', () => {
        assertEqual('object', typeof result[1]);
        assertEqual('123', result[1].id);
    });
});


describe('VirtualHost#matchRequest() with non-matching route', ({ before, it }) => {
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });
    const route1 = new HttpRoute({
        name: 'route1',
        pattern: '/users/:id',
        targets: [ target ],
        errorHandlers: [],
    });

    let vhost;
    let result;

    before(() => {
        vhost = new VirtualHost({
            name: 'test-vhost',
            hostname: '*',
            routes: [ route1 ],
        });
        result = vhost.matchRequest({
            url: { pathname: '/products/123' },
        });
    });

    it('returns array with null elements', () => {
        assertArray(result);
        assertEqual(2, result.length);
        assertEqual(null, result[0]);
        assertEqual(null, result[1]);
    });
});


describe('VirtualHost#matchRequest() with multiple routes', ({ before, it }) => {
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    const route1 = new HttpRoute({
        name: 'route1',
        pattern: '/users/:id',
        targets: [ target ],
        errorHandlers: [],
    });

    const route2 = new HttpRoute({
        name: 'route2',
        pattern: '/products/:id',
        targets: [ target ],
        errorHandlers: [],
    });

    const route3 = new HttpRoute({
        name: 'route3',
        pattern: '/orders/:id',
        targets: [ target ],
        errorHandlers: [],
    });

    let vhost;

    before(() => {
        vhost = new VirtualHost({
            name: 'test-vhost',
            hostname: '*',
            routes: [ route1, route2, route3 ],
        });
    });

    it('finds route1 for /users/123', () => {
        const result = vhost.matchRequest({
            url: { pathname: '/users/123' },
        });
        assertEqual(route1, result[0]);
        assertEqual('123', result[1].id);
    });

    it('finds route2 for /products/456', () => {
        const result = vhost.matchRequest({
            url: { pathname: '/products/456' },
        });
        assertEqual(route2, result[0]);
        assertEqual('456', result[1].id);
    });

    it('finds route3 for /orders/789', () => {
        const result = vhost.matchRequest({
            url: { pathname: '/orders/789' },
        });
        assertEqual(route3, result[0]);
        assertEqual('789', result[1].id);
    });
});


describe('VirtualHost#matchRequest() returns first matching route', ({ before, it }) => {
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    const route1 = new HttpRoute({
        name: 'specific-route',
        pattern: '/users/admin',
        targets: [ target ],
        errorHandlers: [],
    });

    const route2 = new HttpRoute({
        name: 'general-route',
        pattern: '/users/:id',
        targets: [ target ],
        errorHandlers: [],
    });

    let vhost;

    before(() => {
        vhost = new VirtualHost({
            name: 'test-vhost',
            hostname: '*',
            routes: [ route1, route2 ],
        });
    });

    it('matches specific route before general route', () => {
        const result = vhost.matchRequest({
            url: { pathname: '/users/admin' },
        });
        assertEqual(route1, result[0]);
    });

    it('matches general route for other paths', () => {
        const result = vhost.matchRequest({
            url: { pathname: '/users/123' },
        });
        assertEqual(route2, result[0]);
    });
});


describe('VirtualHost#matchRequest() with wildcard route', ({ before, it }) => {
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    const route1 = new HttpRoute({
        name: 'specific-route',
        pattern: '/api/:resource',
        targets: [ target ],
        errorHandlers: [],
    });

    const route2 = new HttpRoute({
        name: 'catch-all',
        pattern: '*',
        targets: [ target ],
        errorHandlers: [],
    });

    let vhost;

    before(() => {
        vhost = new VirtualHost({
            name: 'test-vhost',
            hostname: '*',
            routes: [ route1, route2 ],
        });
    });

    it('matches specific route first', () => {
        const result = vhost.matchRequest({
            url: { pathname: '/api/users' },
        });
        assertEqual(route1, result[0]);
        assertEqual('users', result[1].resource);
    });

    it('catches all other paths with wildcard', () => {
        const result = vhost.matchRequest({
            url: { pathname: '/anything/else' },
        });
        assertEqual(route2, result[0]);
        assertEqual(0, Object.keys(result[1]).length);
    });
});


describe('VirtualHost#matchRequest() with no routes', ({ before, it }) => {
    let vhost;
    let result;

    before(() => {
        vhost = new VirtualHost({
            name: 'empty-vhost',
            hostname: '*',
            routes: [],
        });
        result = vhost.matchRequest({
            url: { pathname: '/anything' },
        });
    });

    it('returns array with null elements', () => {
        assertArray(result);
        assertEqual(null, result[0]);
        assertEqual(null, result[1]);
    });
});


describe('VirtualHost#matchRequest() with complex path parameters', ({ before, it }) => {
    const target = new HttpTarget({
        name: 'target1',
        allowedMethods: [ 'GET' ],
        middleware: [],
        errorHandlers: [],
    });

    const route1 = new HttpRoute({
        name: 'nested-route',
        pattern: '/organizations/:orgId/projects/:projectId/tasks/:taskId',
        targets: [ target ],
        errorHandlers: [],
    });

    let vhost;
    let result;

    before(() => {
        vhost = new VirtualHost({
            name: 'test-vhost',
            hostname: '*',
            routes: [ route1 ],
        });
        result = vhost.matchRequest({
            url: { pathname: '/organizations/org-1/projects/proj-2/tasks/task-3' },
        });
    });

    it('returns the matching route', () => {
        assertEqual(route1, result[0]);
    });

    it('extracts all path parameters', () => {
        assertEqual('org-1', result[1].orgId);
        assertEqual('proj-2', result[1].projectId);
        assertEqual('task-3', result[1].taskId);
    });
});
