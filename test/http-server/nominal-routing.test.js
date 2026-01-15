import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import sinon from 'sinon';

import {
    assertEqual
} from 'kixx-assert';

import HttpRoutesStore from '../../lib/http-routes-store/http-routes-store.js';
import HttpRouter from '../../lib/http-server/http-router.js';
import HttpServerRequest from '../../lib/http-server/http-server-request.js';
import HttpServerResponse from '../../lib/http-server/http-server-response.js';
import Context from '../../lib/application/context.js';


const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(THIS_DIR, 'routing-fixtures');


const app_directory = path.join(FIXTURE_DIR, 'nominal');
const routes_directory = path.join(app_directory, 'routes');

const routesStore = new HttpRoutesStore({
    app_directory,
    routes_directory,
});

const router = new HttpRouter();


describe('nominal app structure', ({ before, after, it }) => {

    const routerErrorHandler = sinon.spy();

    const context = createApplicationContext();

    const middleware = new Map();
    const handlers = new Map();
    const errorHandlers = new Map();

    const url = new URL('https://www.example.com/appapi/v1/templates/base-templates/base.html');

    const request = createRequest('1', url, {
        method: 'GET',
        headers: {
            accept: '*/*',
            'user-agent': 'Kixx/Test',
        },
    });

    const response = new HttpServerResponse('1');

    let serverResponse;

    before(async () => {
        router.on('error', routerErrorHandler);

        const vhosts = await routesStore.loadVirtualHosts(middleware, handlers, errorHandlers);
        router.resetVirtualHosts(vhosts);

        serverResponse = await router.handleHttpRequest(context, request, response);
    });

    after(() => {
        router.off('error', routerErrorHandler);
        sinon.restore();
    });

    it('returns the server response', () => {
        // The same response should be returned, after being
        // mutated by the request/response cycle.
        assertEqual(response, serverResponse);
    });
});

function createApplicationContext() {
    const runtime = { server: { name: 'test' } };
    const config = {};
    const paths = {};
    const logger = {};

    return new Context({
        runtime,
        config,
        paths,
        logger,
    });
}

function createRequest(id, url, options) {
    return new HttpServerRequest(options, url, id);
}
