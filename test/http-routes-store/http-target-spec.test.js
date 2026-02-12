import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import HttpTargetSpec from '../../lib/http-routes-store/http-target-spec.js';
import HttpRouteSpec from '../../lib/http-routes-store/http-route-spec.js';
import VirtualHost from '../../lib/http-server/virtual-host.js';


describe('HttpTargetSpec#toHttpTarget() creates target with correct name format', ({ before, it }) => {
    let targetSpec;
    let routeSpec;
    let vhost;
    let target;

    before(() => {
        targetSpec = new HttpTargetSpec({
            name: 'ViewProduct',
            methods: [ 'GET', 'HEAD' ],
            tags: [],
            handlers: [],
            errorHandlers: [],
        });

        routeSpec = new HttpRouteSpec({
            name: 'Products/:product_id',
            pattern: '/products/:product_id',
            inboundMiddleware: [],
            outboundMiddleware: [],
            errorHandlers: [],
            targets: null,
            routes: null,
        });

        vhost = new VirtualHost({
            name: 'Main',
            hostname: '*',
            routes: [],
        });

        target = targetSpec.toHttpTarget(vhost, routeSpec);
    });

    it('creates target with routeName/targetName format', () => {
        assertEqual('Products/:product_id/ViewProduct', target.name);
    });

    it('does not include virtual host name in target name', () => {
        assert(!target.name.includes('Main:'));
        assert(!target.name.startsWith('Main'));
    });

    it('uses forward slash as delimiter between route and target', () => {
        assert(target.name.includes('/'));
        // Route names may contain colons for path parameters (e.g., :product_id)
        // but the delimiter between route name and target name should be a forward slash
        assert(target.name.endsWith('/ViewProduct'));
    });
});


describe('HttpTargetSpec#toHttpTarget() with nested route names', ({ before, it }) => {
    let targetSpec;
    let routeSpec;
    let vhost;
    let target;

    before(() => {
        targetSpec = new HttpTargetSpec({
            name: 'ViewContext',
            methods: [ 'GET' ],
            tags: [],
            handlers: [],
            errorHandlers: [],
        });

        // Simulate a nested route name (as it would be after mergeParent)
        routeSpec = new HttpRouteSpec({
            name: 'Dashboard/Contexts',
            pattern: '/dashboard/contexts/:id',
            inboundMiddleware: [],
            outboundMiddleware: [],
            errorHandlers: [],
            targets: null,
            routes: null,
        });

        vhost = new VirtualHost({
            name: 'Main',
            hostname: '*',
            routes: [],
        });

        target = targetSpec.toHttpTarget(vhost, routeSpec);
    });

    it('creates target with nested route name format', () => {
        assertEqual('Dashboard/Contexts/ViewContext', target.name);
    });

    it('preserves nested route structure in name', () => {
        assert(target.name.startsWith('Dashboard/'));
        assert(target.name.includes('Contexts/'));
        assert(target.name.endsWith('/ViewContext'));
    });
});


describe('HttpTargetSpec#toHttpTarget() with simple route name', ({ before, it }) => {
    let targetSpec;
    let routeSpec;
    let vhost;
    let target;

    before(() => {
        targetSpec = new HttpTargetSpec({
            name: 'View',
            methods: [ 'GET' ],
            tags: [],
            handlers: [],
            errorHandlers: [],
        });

        routeSpec = new HttpRouteSpec({
            name: 'Home',
            pattern: '/',
            inboundMiddleware: [],
            outboundMiddleware: [],
            errorHandlers: [],
            targets: null,
            routes: null,
        });

        vhost = new VirtualHost({
            name: 'Main',
            hostname: '*',
            routes: [],
        });

        target = targetSpec.toHttpTarget(vhost, routeSpec);
    });

    it('creates target with simple route/target format', () => {
        assertEqual('Home/View', target.name);
    });

    it('does not include virtual host name', () => {
        assert(!target.name.includes('Main'));
        assert(!target.name.startsWith('Main'));
    });
});


describe('HttpTargetSpec.validateAndCreate() requires name property', ({ it }) => {
    it('throws AssertionError when name is missing', () => {
        let error;
        try {
            HttpTargetSpec.validateAndCreate({
                methods: [ 'GET' ],
                handlers: [],
            }, 'TestRoute');
        } catch (err) {
            error = err;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assert(error.message.includes('target.name is required'));
    });

    it('throws AssertionError when name is empty string', () => {
        let error;
        try {
            HttpTargetSpec.validateAndCreate({
                name: '',
                methods: [ 'GET' ],
                handlers: [],
            }, 'TestRoute');
        } catch (err) {
            error = err;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assert(error.message.includes('target.name is required'));
    });

    it('throws AssertionError when name is undefined', () => {
        let error;
        try {
            HttpTargetSpec.validateAndCreate({
                name: undefined,
                methods: [ 'GET' ],
                handlers: [],
            }, 'TestRoute');
        } catch (err) {
            error = err;
        }
        assert(error);
        assertEqual('AssertionError', error.name);
        assert(error.message.includes('target.name is required'));
    });

    it('uses configured name when provided', () => {
        const targetSpec = HttpTargetSpec.validateAndCreate({
            name: 'CustomTargetName',
            methods: [ 'GET' ],
            handlers: [],
        }, 'TestRoute');

        assertEqual('CustomTargetName', targetSpec.name);
    });

    it('does not derive name from methods', () => {
        const targetSpec = HttpTargetSpec.validateAndCreate({
            name: 'ViewProduct',
            methods: [ 'GET', 'HEAD', 'POST' ],
            handlers: [],
        }, 'TestRoute');

        assertEqual('ViewProduct', targetSpec.name);
        assert(!targetSpec.name.includes('GET'));
        assert(!targetSpec.name.includes('HEAD'));
        assert(!targetSpec.name.includes('POST'));
        assert(!targetSpec.name.includes(':'));
    });
});
