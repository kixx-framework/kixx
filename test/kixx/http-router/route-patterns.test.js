import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertUndefined,
} from 'kixx-assert';

import HttpRoute from '../../../kixx/http-router/http-route.js';
import VirtualHost from '../../../kixx/http-router/virtual-host.js';


// Every pattern form Kixx routes use, tested through the router's own classes.
// The pattern syntax comes from the vendored path-to-regexp, so these tests
// hold a new copy of it to the behavior routes rely on.

function makeTargetSpec() {
    return { name: 'get', methods: [ 'GET' ], requestHandlers: [ () => {} ] };
}

function makeRoute(pattern) {
    return HttpRoute.fromSpecification({ pattern, targets: [ makeTargetSpec() ] });
}

// Builds the route the router makes for a child nested under a parent.
function makeNestedRoute(parentPattern, childPattern) {
    const vhost = VirtualHost.fromSpecification({
        hostname: 'example.com',
        routes: [
            {
                pattern: parentPattern,
                routes: [ { pattern: childPattern, targets: [ makeTargetSpec() ] } ],
            },
        ],
    });

    return vhost.routes[0];
}

function compilePathname(pattern, params) {
    return makeRoute(pattern).targets[0].compilePathname(params).pathname;
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('route patterns', ({ describe }) => {

    describe('a named parameter: /users/:id', ({ it }) => {
        const route = makeRoute('/users/:id');

        it('captures the parameter', () => {
            assertEqual('42', route.matchPathname('/users/42').id);
        });

        it('matches with one trailing slash', () => {
            assertEqual('42', route.matchPathname('/users/42/').id);
        });

        it('does not match without the parameter', () => {
            assertEqual(null, route.matchPathname('/users'));
        });

        it('does not match a parameter that spans two segments', () => {
            assertEqual(null, route.matchPathname('/users/a/b'));
        });

        it('does not match a doubled trailing slash', () => {
            assertEqual(null, route.matchPathname('/users/42//'));
        });

        it('ignores case in the fixed text', () => {
            assertEqual('42', route.matchPathname('/USERS/42').id);
        });

        it('decodes a percent-encoded parameter', () => {
            assertEqual('café', route.matchPathname('/users/caf%C3%A9').id);
        });
    });

    describe('an optional trailing slash: {/}', ({ it }) => {
        it('matches /admin{/} with and without the slash', () => {
            const route = makeRoute('/admin{/}');

            assert(route.matchPathname('/admin'), 'expected /admin to match');
            assert(route.matchPathname('/admin/'), 'expected /admin/ to match');
        });

        it('does not match a deeper path', () => {
            assertEqual(null, makeRoute('/admin{/}').matchPathname('/admin/x'));
        });

        it('matches after a fixed segment', () => {
            const route = makeRoute('/admin/users{/}');

            assert(route.matchPathname('/admin/users'), 'expected /admin/users to match');
            assert(route.matchPathname('/admin/users/'), 'expected /admin/users/ to match');
        });

        it('matches after a parameter', () => {
            const route = makeRoute('/admin/users/:id{/}');

            assertEqual('7', route.matchPathname('/admin/users/7').id);
            assertEqual('7', route.matchPathname('/admin/users/7/').id);
        });

        it('does not match an empty parameter', () => {
            assertEqual(null, makeRoute('/admin/users/:id{/}').matchPathname('/admin/users/'));
        });
    });

    describe('an optional suffix: /users/admin/new{.:suffix}', ({ it }) => {
        const route = makeRoute('/users/admin/new{.:suffix}');

        it('matches without the suffix', () => {
            const params = route.matchPathname('/users/admin/new');

            assert(params, 'expected /users/admin/new to match');
            assertUndefined(params.suffix);
        });

        it('captures the suffix', () => {
            assertEqual('json', route.matchPathname('/users/admin/new.json').suffix);
        });

        it('matches with a trailing slash', () => {
            const params = route.matchPathname('/users/admin/new/');

            assert(params, 'expected /users/admin/new/ to match');
            assertUndefined(params.suffix);
        });

        it('does not match a dot with no suffix', () => {
            assertEqual(null, route.matchPathname('/users/admin/new.'));
        });
    });

    describe('a wildcard: /assets/:hash/*pathname', ({ it }) => {
        const route = makeRoute('/assets/:hash/*pathname');

        it('captures the rest of the path as a list of segments', () => {
            const params = route.matchPathname('/assets/abc/css/site.css');

            assertEqual('abc', params.hash);
            assert(Array.isArray(params.pathname), 'expected pathname to be an Array');
            assertEqual(2, params.pathname.length);
            assertEqual('css', params.pathname[0]);
            assertEqual('site.css', params.pathname[1]);
        });

        it('does not match without a wildcard segment', () => {
            assertEqual(null, route.matchPathname('/assets/abc'));
            assertEqual(null, route.matchPathname('/assets/abc/'));
        });
    });

    describe('two parameters in one segment: /:filename.:extension', ({ it }) => {
        const route = makeRoute('/:filename.:extension');

        it('captures the name and the extension', () => {
            const favicon = route.matchPathname('/favicon.ico');

            assertEqual('favicon', favicon.filename);
            assertEqual('ico', favicon.extension);

            const index = route.matchPathname('/index.json');

            assertEqual('index', index.filename);
            assertEqual('json', index.extension);
        });

        it('does not match a name with no extension', () => {
            assertEqual(null, route.matchPathname('/foo'));
        });

        it('does not match an extension with no name', () => {
            assertEqual(null, route.matchPathname('/.well-known'));
        });

        it('does not match a deeper path', () => {
            assertEqual(null, route.matchPathname('/a/b.c'));
        });
    });

    describe('a "*" child under a parent route', ({ it }) => {
        it('matches the parent path and everything below it', () => {
            const route = makeNestedRoute('/api', '*');

            assertEqual('/api{/*path}', route.pattern);
            assert(route.matchPathname('/api'), 'expected /api to match');
            assert(route.matchPathname('/api/'), 'expected /api/ to match');

            const params = route.matchPathname('/api/a/b');

            assertEqual(2, params.path.length);
            assertEqual('a', params.path[0]);
            assertEqual('b', params.path[1]);
        });

        it('does not match a path that only starts with the parent text', () => {
            assertEqual(null, makeNestedRoute('/api', '*').matchPathname('/apix'));
        });

        it('matches every path under a "/" parent', () => {
            const route = makeNestedRoute('/', '*');

            assertEqual('/{*path}', route.pattern);
            assert(route.matchPathname('/'), 'expected / to match');

            const params = route.matchPathname('/a/b');

            assertEqual(2, params.path.length);
            assertEqual('a', params.path[0]);
            assertEqual('b', params.path[1]);
        });
    });

    describe('a hostname pattern: :sub.example.com', ({ it }) => {
        const vhost = VirtualHost.fromSpecification({
            pattern: ':sub.example.com',
            routes: [ { pattern: '/', targets: [ makeTargetSpec() ] } ],
        });

        it('captures the subdomain', () => {
            assertEqual('www', vhost.matchHostname('www.example.com').sub);
        });

        it('does not match the bare domain', () => {
            assertEqual(null, vhost.matchHostname('example.com'));
        });
    });

    describe('compiling a pathname from a pattern', ({ it }) => {
        it('encodes a parameter', () => {
            assertEqual('/users/a%20b', compilePathname('/users/:id', { id: 'a b' }));
        });

        it('throws when a parameter is missing', () => {
            const caught = catchError(() => compilePathname('/users/:id', {}));

            assert(caught, 'expected an error to be thrown');
        });

        it('joins a wildcard list with slashes', () => {
            const pathname = compilePathname('/assets/:hash/*pathname', {
                hash: 'abc',
                pathname: [ 'css', 'site.css' ],
            });

            assertEqual('/assets/abc/css/site.css', pathname);
        });

        it('leaves out an optional suffix that is not given', () => {
            assertEqual('/users/admin/new', compilePathname('/users/admin/new{.:suffix}', {}));
        });

        it('writes an optional suffix that is given', () => {
            const pathname = compilePathname('/users/admin/new{.:suffix}', { suffix: 'json' });

            assertEqual('/users/admin/new.json', pathname);
        });
    });

    describe('an invalid pattern', ({ it }) => {
        const invalidPatterns = [ '/a(b)', '/a?', '/:a:b', '/{a' ];

        for (const pattern of invalidPatterns) {
            it(`throws when a route is built with ${ pattern }`, () => {
                const caught = catchError(() => makeRoute(pattern));

                assert(caught, 'expected an error to be thrown');
            });
        }
    });
});
