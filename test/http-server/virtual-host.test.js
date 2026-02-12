import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
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


