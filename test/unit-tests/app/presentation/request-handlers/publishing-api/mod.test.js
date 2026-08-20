import { describe } from 'kixx-test';
import { assert, assertEqual, assertUndefined } from 'kixx-assert';

import {
    StatResource,
    PutResource,
    CommitChanges,
} from '../../../../../../src/app/presentation/request-handlers/publishing-api/mod.js';
import ServerResponse from '../../../../../../src/kixx/http-router/server-response.js';
import {
    normalizePathname,
    isValidPathname,
    isValidTemplateFilepath,
} from '../../../../../../src/kixx/hyperview/content-layout.js';


// Real content-layout pathname rules, not a loose stub, so path validation in
// these tests exercises the same rules production code enforces.
function makeContentService(results) {
    results = results ?? {};
    const calls = [];

    const methodNames = [
        'statTemplatePartials',
        'statBaseTemplates',
        'statPageMetadata',
        'statPagePartials',
        'statPageIncludes',
        'statPageTemplate',
        'putTemplatePartials',
        'putBaseTemplates',
        'putPageMetadata',
        'putPagePartials',
        'putPageIncludes',
        'putPageTemplate',
        'commitChanges',
    ];

    const service = {
        calls,
        normalizePathname,
        isValidPathname,
        isValidTemplateFilepath,
    };

    for (const name of methodNames) {
        service[name] = async (...args) => {
            calls.push([ name, ...args ]);
            return results[name];
        };
    }

    return service;
}

function makeContext(contentService, buildId = 'runtime-build-id') {
    return {
        runtime: { build: { id: buildId } },
        getService(name) {
            assertEqual('HyperviewContent', name);
            return contentService;
        },
    };
}

function makeRequest(options) {
    const {
        pathnameParams = {},
        textBody = '',
        jsonBody = {},
        checksum = null,
        contentMediaType = null,
    } = options ?? {};

    return {
        pathnameParams,
        headers: {
            get(name) {
                if (name.toLowerCase() === 'x-checksum') {
                    return checksum;
                }
                return null;
            },
        },
        async text() {
            return textBody;
        },
        async json() {
            return jsonBody;
        },
        getContentMediaType() {
            return contentMediaType;
        },
    };
}

function makeResponse() {
    return new ServerResponse();
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('publishing-api request handlers', ({ describe }) => {

    describe('StatResource()', ({ describe, it }) => {

        describe('the six catalog entries', ({ it }) => {
            it('template_partials calls statTemplatePartials with no path', async () => {
                const contentService = makeContentService({ statTemplatePartials: { etag: 'v1' } });
                const context = makeContext(contentService);
                const request = makeRequest();
                const response = makeResponse();

                await StatResource({ type: 'template_partials' })(context, request, response);

                assertEqual(1, contentService.calls.length);
                assertEqual('statTemplatePartials', contentService.calls[0][0]);
                assertEqual(200, response.status);
                const body = JSON.parse(response.body);
                assertEqual('template_partials', body.data.type);
                assertEqual('v1', body.data.attributes.etag);
            });

            it('base_templates calls statBaseTemplates with no path', async () => {
                const contentService = makeContentService({ statBaseTemplates: { etag: 'v1' } });
                const context = makeContext(contentService);
                const request = makeRequest();
                const response = makeResponse();

                await StatResource({ type: 'base_templates' })(context, request, response);

                assertEqual('statBaseTemplates', contentService.calls[0][0]);
                assertEqual(200, response.status);
            });

            it('page_metadata calls statPageMetadata with the normalized page path', async () => {
                const contentService = makeContentService({ statPageMetadata: { etag: 'v1' } });
                const context = makeContext(contentService);
                const request = makeRequest({ pathnameParams: { path: [ 'Articles', 'Example' ] } });
                const response = makeResponse();

                await StatResource({ type: 'page_metadata' })(context, request, response);

                const [ name, , pathname ] = contentService.calls[0];
                assertEqual('statPageMetadata', name);
                assertEqual('/articles/example', pathname);
                assertEqual(200, response.status);
            });

            it('page_partials calls statPagePartials with the normalized page path', async () => {
                const contentService = makeContentService({ statPagePartials: { etag: 'v1' } });
                const context = makeContext(contentService);
                const request = makeRequest({ pathnameParams: { path: [ 'articles' ] } });
                const response = makeResponse();

                await StatResource({ type: 'page_partials' })(context, request, response);

                assertEqual('statPagePartials', contentService.calls[0][0]);
            });

            it('page_includes calls statPageIncludes with the normalized page path', async () => {
                const contentService = makeContentService({ statPageIncludes: { etag: 'v1' } });
                const context = makeContext(contentService);
                const request = makeRequest({ pathnameParams: { path: [ 'articles' ] } });
                const response = makeResponse();

                await StatResource({ type: 'page_includes' })(context, request, response);

                assertEqual('statPageIncludes', contentService.calls[0][0]);
            });

            it('page_templates calls statPageTemplate with the normalized template filepath', async () => {
                const contentService = makeContentService({ statPageTemplate: { etag: 'v1' } });
                const context = makeContext(contentService);
                const request = makeRequest({ pathnameParams: { path: [ 'articles', 'page.html' ] } });
                const response = makeResponse();

                await StatResource({ type: 'page_templates' })(context, request, response);

                const [ name, , filepath ] = contentService.calls[0];
                assertEqual('statPageTemplate', name);
                assertEqual('/articles/page.html', filepath);
                assertEqual(200, response.status);
            });
        });

        it('rejects a page_templates request that resolves to the root without calling the service', async () => {
            const contentService = makeContentService();
            const context = makeContext(contentService);
            // Simulates the "/page-templates/" trailing-slash spelling: the
            // wildcard group matches with a single empty segment.
            const request = makeRequest({ pathnameParams: { path: [ '' ] } });
            const response = makeResponse();

            const caught = await catchAsyncError(() => {
                return StatResource({ type: 'page_templates' })(context, request, response);
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertEqual('InvalidPagePath', caught.code);
            assertEqual(0, contentService.calls.length);
        });

        it('accepts a page_metadata request that resolves to the root ("/page-metadata/")', async () => {
            const contentService = makeContentService({ statPageMetadata: { etag: 'v1' } });
            const context = makeContext(contentService);
            const request = makeRequest({ pathnameParams: { path: [ '' ] } });
            const response = makeResponse();

            await StatResource({ type: 'page_metadata' })(context, request, response);

            const [ , , pathname ] = contentService.calls[0];
            assertEqual('/', pathname);
        });

        it('rejects a page-path request with no path segments captured ("/page-metadata")', async () => {
            const contentService = makeContentService();
            const context = makeContext(contentService);
            // Simulates the bare "/page-metadata" spelling: the optional
            // wildcard group matches nothing at all.
            const request = makeRequest({ pathnameParams: {} });
            const response = makeResponse();

            const caught = await catchAsyncError(() => {
                return StatResource({ type: 'page_metadata' })(context, request, response);
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('BadRequestError', caught.name);
            assertEqual('PagePathRequired', caught.code);
            assertEqual(0, contentService.calls.length);
        });

        it('rejects an invalid page path without calling the service', async () => {
            const contentService = makeContentService();
            const context = makeContext(contentService);
            const request = makeRequest({ pathnameParams: { path: [ '..', 'secret' ] } });
            const response = makeResponse();

            const caught = await catchAsyncError(() => {
                return StatResource({ type: 'page_metadata' })(context, request, response);
            });

            assertEqual('BadRequestError', caught.name);
            assertEqual('InvalidPagePath', caught.code);
            assertEqual(0, contentService.calls.length);
        });

        it('throws NotFoundError when the resource is absent', async () => {
            const contentService = makeContentService({ statPageMetadata: null });
            const context = makeContext(contentService);
            const request = makeRequest({ pathnameParams: { path: [ 'missing' ] } });
            const response = makeResponse();

            const caught = await catchAsyncError(() => {
                return StatResource({ type: 'page_metadata' })(context, request, response);
            });

            assert(caught, 'expected an error to be thrown');
            assertEqual('NotFoundError', caught.name);
            assert(caught.message.includes('/missing'), `expected pathname in "${ caught.message }"`);
        });
    });

    describe('PutResource()', ({ it }) => {
        it('reads a JSON payload for page_metadata and forwards pathname, metadata, and etag', async () => {
            const contentService = makeContentService({
                putPageMetadata: { hash: 'h1', size: 10, metadata: null },
            });
            const context = makeContext(contentService);
            const request = makeRequest({
                pathnameParams: { path: [ 'articles' ] },
                jsonBody: { title: 'Hello' },
                checksum: 'expected-etag',
            });
            const response = makeResponse();

            await PutResource({ type: 'page_metadata' })(context, request, response);

            const [ name, , args ] = contentService.calls[0];
            assertEqual('putPageMetadata', name);
            assertEqual('/articles', args.pathname);
            assertEqual('Hello', args.metadata.title);
            assertEqual('expected-etag', args.etag);
            assertEqual(201, response.status);
        });

        it('reads a text payload for page_templates and forwards filepath and source', async () => {
            const contentService = makeContentService({
                putPageTemplate: { hash: 'h1', size: 20, metadata: null },
            });
            const context = makeContext(contentService);
            const request = makeRequest({
                pathnameParams: { path: [ 'articles', 'page.html' ] },
                textBody: '<main>{{ body }}</main>',
            });
            const response = makeResponse();

            await PutResource({ type: 'page_templates' })(context, request, response);

            const [ name, , args ] = contentService.calls[0];
            assertEqual('putPageTemplate', name);
            assertEqual('/articles/page.html', args.filepath);
            assertEqual('<main>{{ body }}</main>', args.source);
            assertEqual(201, response.status);
        });

        it('rejects a page_templates request that resolves to the root without calling the service', async () => {
            const contentService = makeContentService();
            const context = makeContext(contentService);
            const request = makeRequest({
                pathnameParams: { path: [ '' ] },
                textBody: 'source',
            });
            const response = makeResponse();

            const caught = await catchAsyncError(() => {
                return PutResource({ type: 'page_templates' })(context, request, response);
            });

            assertEqual('BadRequestError', caught.name);
            assertEqual('InvalidPagePath', caught.code);
            assertEqual(0, contentService.calls.length);
        });

        it('uploads template_partials with no path validation', async () => {
            const contentService = makeContentService({
                putTemplatePartials: { hash: 'h1', size: 5, metadata: null },
            });
            const context = makeContext(contentService);
            const request = makeRequest({ jsonBody: [ { id: 'x', source: 'y' } ] });
            const response = makeResponse();

            await PutResource({ type: 'template_partials' })(context, request, response);

            const [ name, , args ] = contentService.calls[0];
            assertEqual('putTemplatePartials', name);
            assertUndefined(args.pathname);
            assertEqual(201, response.status);
        });
    });

    describe('CommitChanges()', ({ it }) => {
        function commitRequest(attributes) {
            return makeRequest({
                jsonBody: {
                    data: {
                        type: 'ContentTree',
                        attributes,
                    },
                },
                contentMediaType: 'application/vnd.api+json',
            });
        }

        it('maps manifest fields and preserves the response shape', async () => {
            const contentService = makeContentService({
                commitChanges: { hash: 'root-hash', count: 12 },
            });
            const context = makeContext(contentService);
            const request = commitRequest({
                buildId: 'explicit-build',
                templatePartials: { hash: 'tp', size: 1 },
                baseTemplates: { hash: 'bt', size: 2 },
                pageMetadata: [ { pathname: '/a', hash: 'h', size: 1 } ],
                pagePartials: [],
                pageIncludes: [],
                pageTemplates: [],
            });
            const response = makeResponse();

            await CommitChanges()(context, request, response);

            const [ name, , args ] = contentService.calls[0];
            assertEqual('commitChanges', name);
            assertEqual('explicit-build', args.buildId);
            assertEqual('tp', args.manifest.templatePartials.hash);
            assertEqual('bt', args.manifest.baseTemplates.hash);
            assertEqual('/a', args.manifest.pageMetadata[0].pathname);

            assertEqual(201, response.status);
            const body = JSON.parse(response.body);
            assertEqual('ContentTree', body.data.type);
            assertEqual('root-hash', body.data.id);
            assertEqual('root-hash', body.data.attributes.hash);
            assertEqual(12, body.data.attributes.nodeCount);
        });

        it('forwards an omitted buildId as undefined rather than resolving it itself', async () => {
            const contentService = makeContentService({
                commitChanges: { hash: 'root-hash', count: 1 },
            });
            const context = makeContext(contentService, 'runtime-build-id');
            const request = commitRequest({});
            const response = makeResponse();

            await CommitChanges()(context, request, response);

            const [ , , args ] = contentService.calls[0];
            assertUndefined(args.buildId);
        });
    });
});
