import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import respondWithHyperviewPage from '../../../kixx/hyperview/respond-with-hyperview-page.js';
import ServerResponse from '../../../kixx/http-router/server-response.js';
import { sha256Hex } from '../../../kixx/utils/crypto.js';


const PUBLIC_OPTIONS = { responseOptions: { cacheControl: 'public, no-cache' } };


function makeRequest(headers, href, method) {
    return {
        method: method ?? 'GET',
        headers: new Headers(headers),
        url: new URL(href ?? 'https://www.example.com/'),
    };
}

async function getBodyEtag() {
    return `"${ await sha256Hex('<main>Account</main>') }"`;
}

function makeSubject() {
    const calls = [];
    const hyperviewService = {
        async renderPage(context, options) {
            calls.push({ context, options });
            return { type: 'hypertext', hypertext: '<main>Account</main>' };
        },
    };
    const context = {
        getService(name) {
            assertEqual('HyperviewService', name);
            return hyperviewService;
        },
    };

    return { calls, context };
}


describe('respondWithHyperviewPage', ({ describe: group, it }) => {

    it('applies defaults, response rendering options, and client render modes in order', async () => {
        const { calls, context } = makeSubject();
        const request = makeRequest({
            'kixx-partial': 'client-partial',
            'kixx-boosted': 'true',
        });
        const response = new ServerResponse();
        response.setRenderingOptions({
            pathname: '/response-page',
            partial: 'response-partial',
            skipBaseRender: false,
        });

        const returned = await respondWithHyperviewPage(
            context,
            request,
            response,
            {
                pathname: '/default-page',
                partial: 'default-partial',
                baseTemplateId: 'default.html',
            },
        );

        assertEqual(response, returned);
        assertEqual(1, calls.length);
        assertEqual('/response-page', calls[0].options.pathname);
        assertEqual('default.html', calls[0].options.baseTemplateId);
        assertEqual('client-partial', calls[0].options.partial);
        assertEqual(true, calls[0].options.skipBaseRender);
        assertEqual(request.url, calls[0].options.url);
        assertEqual(response.props, calls[0].options.props);
        assertEqual('<main>Account</main>', response.body);
        assertEqual('text/html; charset=utf-8', response.headers.get('content-type'));
    });

    it('does not place rendering controls in template props', async () => {
        const { calls, context } = makeSubject();
        const response = new ServerResponse();
        response.updateProps({ page: { title: 'Account' } });
        response.setRenderingOptions({ pathname: '/account' });

        await respondWithHyperviewPage(context, makeRequest(), response);

        assertEqual('/account', calls[0].options.pathname);
        assertEqual(undefined, response.props.pathname);
        assertEqual('Account', response.props.page.title);
    });

    it('preserves an explicit hypertext content type', async () => {
        const { context } = makeSubject();
        const response = new ServerResponse();

        await respondWithHyperviewPage(
            context,
            makeRequest(),
            response,
            { responseOptions: { contentType: 'application/xml' } },
        );

        assertEqual('application/xml; charset=utf-8', response.headers.get('content-type'));
    });

    it('serializes a page-context result without passing response options to the service', async () => {
        const { calls, context } = makeSubject();
        context.getService = () => ({
            async renderPage(_context, options) {
                calls.push({ options });
                return { type: 'page-context', pageContext: { pathname: '/' } };
            },
        });
        const response = new ServerResponse();

        await respondWithHyperviewPage(
            context,
            makeRequest(),
            response,
            { responseOptions: { contentType: 'text/html' } },
        );

        assertEqual('/', JSON.parse(response.body).pathname);
        assertEqual(undefined, calls[0].options.responseOptions);
    });

    it('varies every response on the render mode request headers', async () => {
        const { context } = makeSubject();
        const response = new ServerResponse();

        await respondWithHyperviewPage(context, makeRequest(), response);

        assertEqual('kixx-partial, kixx-boosted', response.headers.get('vary'));
    });

    it('adds no cache policy or validator without responseOptions.cacheControl', async () => {
        const { context } = makeSubject();
        const response = new ServerResponse();

        await respondWithHyperviewPage(context, makeRequest(), response);

        assertEqual(null, response.headers.get('cache-control'));
        assertEqual(null, response.headers.get('etag'));
    });

    it('sets the configured cache policy and a body-hash ETag', async () => {
        const { context } = makeSubject();
        const response = new ServerResponse();

        await respondWithHyperviewPage(context, makeRequest(), response, PUBLIC_OPTIONS);

        assertEqual(200, response.status);
        assertEqual('public, no-cache', response.headers.get('cache-control'));
        assertEqual(await getBodyEtag(), response.headers.get('etag'));
        assertEqual('<main>Account</main>', response.body);
    });

    it('responds 304 without a body when If-None-Match matches, including a weakened ETag', async () => {
        const { context } = makeSubject();
        const response = new ServerResponse();
        const request = makeRequest({ 'if-none-match': `W/${ await getBodyEtag() }` });

        await respondWithHyperviewPage(context, request, response, PUBLIC_OPTIONS);

        assertEqual(304, response.status);
        assertEqual(null, response.body);
        assertEqual(null, response.headers.get('content-type'));
        assertEqual(null, response.headers.get('content-length'));
        assertEqual(await getBodyEtag(), response.headers.get('etag'));
        assertEqual('public, no-cache', response.headers.get('cache-control'));
        assertEqual('kixx-partial, kixx-boosted', response.headers.get('vary'));
    });

    it('responds 200 when If-None-Match does not match', async () => {
        const { context } = makeSubject();
        const response = new ServerResponse();

        await respondWithHyperviewPage(context, makeRequest({ 'if-none-match': '"stale"' }), response, PUBLIC_OPTIONS);

        assertEqual(200, response.status);
        assertEqual('<main>Account</main>', response.body);
    });

    it('does not apply the cache policy to an error status', async () => {
        const { context } = makeSubject();
        const response = new ServerResponse();
        response.status = 422;

        await respondWithHyperviewPage(context, makeRequest({ 'if-none-match': await getBodyEtag() }), response, PUBLIC_OPTIONS);

        assertEqual(422, response.status);
        assertEqual(null, response.headers.get('cache-control'));
        assertEqual(null, response.headers.get('etag'));
    });

    it('does not apply the cache policy to a POST', async () => {
        const { context } = makeSubject();
        const response = new ServerResponse();
        const request = makeRequest({ 'if-none-match': await getBodyEtag() }, null, 'POST');

        await respondWithHyperviewPage(context, request, response, PUBLIC_OPTIONS);

        assertEqual(200, response.status);
        assertEqual(null, response.headers.get('cache-control'));
        assertEqual(null, response.headers.get('etag'));
    });

    it('does not pass cacheControl to the render service', async () => {
        const { calls, context } = makeSubject();
        const response = new ServerResponse();

        await respondWithHyperviewPage(context, makeRequest(), response, PUBLIC_OPTIONS);

        assertEqual(undefined, calls[0].options.responseOptions);
        assertEqual(undefined, calls[0].options.cacheControl);
    });

    // OP-D: in development a page that fails the compiler's checks answers
    // 500 with its problems. Everywhere else the caller decides (D35).
    group('a page with content problems', ({ it: test }) => {

        function makeProblemsError() {
            const error = new Error('The page "/about" can\'t be rendered: its content has 2 problem(s)');
            error.code = 'ContentProblems';
            error.httpStatusCode = 500;
            error.pathname = '/about';
            error.problems = [
                {
                    code: 'template-syntax-error',
                    message: 'Unexpected "<script>alert(1)</script>" & \'more\'',
                    filepath: 'pages/about/<b>"page".html',
                },
                {
                    code: 'missing-partial',
                    message: 'The partial "nav.html" does not exist',
                    filepath: 'templates/base/default.html',
                },
            ];
            return error;
        }

        function makeFailingContext(error, environment) {
            return {
                config: { environment },
                getService() {
                    return {
                        async renderPage() {
                            throw error;
                        },
                    };
                },
            };
        }

        async function catchAsyncError(fn) {
            try {
                await fn();
            } catch (error) {
                return error;
            }
            return null;
        }

        test('answers 500 with every problem listed in development', async () => {
            const response = new ServerResponse();

            const returned = await respondWithHyperviewPage(
                makeFailingContext(makeProblemsError(), 'development'),
                makeRequest(),
                response,
                { baseTemplateId: 'default.html' },
            );

            assertEqual(response, returned);
            assertEqual(500, response.status);
            assertEqual('text/html; charset=utf-8', response.headers.get('content-type'));
            assertEqual('no-store', response.headers.get('cache-control'));

            assert(response.body.startsWith('<!doctype html>'));
            assert(response.body.includes('/about'));
            assert(response.body.includes('template-syntax-error'));
            assert(response.body.includes('missing-partial'));
            assert(response.body.includes('The partial &quot;nav.html&quot; does not exist'));
            assert(response.body.includes('templates/base/default.html'));
        });

        test('escapes every value it writes', async () => {
            const response = new ServerResponse();

            await respondWithHyperviewPage(
                makeFailingContext(makeProblemsError(), 'development'),
                makeRequest(),
                response,
            );

            assertEqual(false, response.body.includes('<script>'));
            assertEqual(false, response.body.includes('<b>'));
            assertEqual(false, response.body.includes('"page"'));
            // Values are written only as element text, where an apostrophe is inert.
            assert(response.body.includes('&lt;script&gt;alert(1)&lt;/script&gt;&quot; &amp; '));
            assert(response.body.includes('pages/about/&lt;b&gt;'));
        });

        test('references nothing from the project', async () => {
            const response = new ServerResponse();

            await respondWithHyperviewPage(
                makeFailingContext(makeProblemsError(), 'development'),
                makeRequest(),
                response,
            );

            assertEqual(false, response.body.includes('<link'));
            assertEqual(false, response.body.includes('<script'));
            assertEqual(false, response.body.includes('<img'));
        });

        test('rethrows the same error outside development and lists nothing', async () => {
            for (const environment of [ 'production', 'staging', 'local', undefined ]) {
                const error = makeProblemsError();
                const response = new ServerResponse();

                const caught = await catchAsyncError(() => respondWithHyperviewPage(
                    makeFailingContext(error, environment),
                    makeRequest(),
                    response,
                ));

                assertEqual(error, caught);
                assertEqual(null, response.body ?? null);
            }
        });

        test('rethrows any other error in development', async () => {
            const error = new Error('Something else');
            error.code = 'SomethingElse';

            const caught = await catchAsyncError(() => respondWithHyperviewPage(
                makeFailingContext(error, 'development'),
                makeRequest(),
                new ServerResponse(),
            ));

            assertEqual(error, caught);
        });
    });
});
