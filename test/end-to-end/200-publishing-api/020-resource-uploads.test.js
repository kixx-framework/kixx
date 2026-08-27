import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import { createPublishingApiToken } from '../test-helpers/publishing-workflows.js';
import { getBaseUrl } from '../test-helpers/target-url.js';
import {
    createRunPrefix,
    createRunScopedPathname,
} from './helpers.js';


const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';
const RUN_PREFIX = createRunPrefix();
const STATIC_ASSET_PATHNAME = createRunScopedPathname(RUN_PREFIX, 'assets/site.css');
const PAGE_PATHNAME = createRunScopedPathname(RUN_PREFIX, 'pages/example');
const PAGE_TEMPLATE_PATHNAME = createRunScopedPathname(RUN_PREFIX, 'pages/example/page.html');
const EMAIL_PATHNAME = createRunScopedPathname(RUN_PREFIX, 'emails/welcome');

const STATIC_ASSET = new Uint8Array([ 0, 1, 2, 3 ]);
const GLOBAL_TEMPLATE_PARTIALS = [ { id: 'header', source: '<header>Global</header>' } ];
const BASE_TEMPLATES = [ { id: 'base', source: '<main>{{content}}</main>' } ];
const PAGE_METADATA = { title: 'Upload coverage' };
const PAGE_PARTIALS = [ { id: 'hero', source: '<section>Hero</section>' } ];
const PAGE_INCLUDES = { footer: '<footer>Footer</footer>' };
const PAGE_TEMPLATE = '<article>{{title}}</article>';
const EMAIL_ASSETS = {
    htmlTemplate: { id: 'welcome.html', source: '<h1>Welcome</h1>' },
    includes: { footer: '<footer>Footer</footer>' },
    partials: [ { id: 'greeting', source: '<p>Hello</p>' } ],
    textTemplate: { id: 'welcome.txt', source: 'Welcome' },
};

let publishingToken;
let staticAssetResponse;
let globalTemplatePartialsResponse;
let baseTemplatesResponse;
let pageMetadataResponse;
let pagePartialsResponse;
let pageIncludesResponse;
let pageTemplateResponse;
let emailAssetsResponse;
let invalidBundleResponse;
let invalidIncludesResponse;
let invalidEmailAssetsResponse;
let emptyStaticAssetResponse;


describe('Publishing API resource uploads', ({ before, it }) => {

    before(async () => {
        const token = await createPublishingApiToken({
            description: `${ RUN_PREFIX } resource uploads`,
        });
        publishingToken = token.token;

        staticAssetResponse = await putResource(`resources/static-asset/${ STATIC_ASSET_PATHNAME }`, STATIC_ASSET);
        globalTemplatePartialsResponse = await putJsonApiResource(
            'resources/global-template-partials',
            'GlobalTemplatePartials',
            { bundle: GLOBAL_TEMPLATE_PARTIALS },
        );
        baseTemplatesResponse = await putJsonApiResource(
            'resources/base-templates',
            'BaseTemplates',
            { bundle: BASE_TEMPLATES },
        );
        pageMetadataResponse = await putJsonApiResource(
            `resources/page-metadata/${ PAGE_PATHNAME }`,
            'PageMetadata',
            PAGE_METADATA,
        );
        pagePartialsResponse = await putJsonApiResource(
            `resources/page-partials/${ PAGE_PATHNAME }`,
            'PagePartials',
            { bundle: PAGE_PARTIALS },
        );
        pageIncludesResponse = await putJsonApiResource(
            `resources/page-includes/${ PAGE_PATHNAME }`,
            'PageIncludes',
            { bundle: PAGE_INCLUDES },
        );
        pageTemplateResponse = await putResource(
            `resources/page-templates/${ PAGE_TEMPLATE_PATHNAME }`,
            PAGE_TEMPLATE,
            'text/plain',
        );
        emailAssetsResponse = await putJsonApiResource(
            `resources/emails/${ EMAIL_PATHNAME }`,
            'EmailAssets',
            EMAIL_ASSETS,
        );

        invalidBundleResponse = await putJsonApiResource(
            'resources/global-template-partials',
            'GlobalTemplatePartials',
            { bundle: [ {} ] },
        );
        invalidIncludesResponse = await putJsonApiResource(
            `resources/page-includes/${ PAGE_PATHNAME }`,
            'PageIncludes',
            { bundle: { invalid: 1 } },
        );
        invalidEmailAssetsResponse = await putJsonApiResource(
            `resources/emails/${ EMAIL_PATHNAME }`,
            'EmailAssets',
            { partials: [ {} ] },
        );
        emptyStaticAssetResponse = await putResource(
            `resources/static-asset/${ createRunScopedPathname(RUN_PREFIX, 'assets/empty.bin') }`,
            new Uint8Array(),
        );
    });

    it('uploads a static asset', () => {
        assertUploadedResource(staticAssetResponse, 'StaticAsset', STATIC_ASSET.byteLength, STATIC_ASSET_PATHNAME);
    });

    it('uploads global template partials', () => {
        assertUploadedResource(globalTemplatePartialsResponse, 'GlobalTemplatePartials', byteLength(GLOBAL_TEMPLATE_PARTIALS));
    });

    it('uploads base templates', () => {
        assertUploadedResource(baseTemplatesResponse, 'BaseTemplates', byteLength(BASE_TEMPLATES));
    });

    it('uploads page metadata', () => {
        assertUploadedResource(pageMetadataResponse, 'PageMetadata', byteLength(PAGE_METADATA), PAGE_PATHNAME);
    });

    it('uploads page partials', () => {
        assertUploadedResource(pagePartialsResponse, 'PagePartials', byteLength(PAGE_PARTIALS), PAGE_PATHNAME);
    });

    it('uploads page includes', () => {
        assertUploadedResource(pageIncludesResponse, 'PageIncludes', byteLength(PAGE_INCLUDES), PAGE_PATHNAME);
    });

    it('uploads a page template', () => {
        assertUploadedResource(pageTemplateResponse, 'PageTemplate', byteLength(PAGE_TEMPLATE), PAGE_TEMPLATE_PATHNAME);
    });

    it('uploads email assets', () => {
        assertUploadedResource(emailAssetsResponse, 'EmailAssets', byteLength(EMAIL_ASSETS), EMAIL_PATHNAME);
    });

    it('rejects an invalid template bundle', () => {
        assertErrorResponse(invalidBundleResponse, 422, 'VALIDATION_ERROR');
    });

    it('rejects page includes with non-string content', () => {
        assertErrorResponse(invalidIncludesResponse, 422, 'VALIDATION_ERROR');
    });

    it('rejects malformed email assets', () => {
        assertErrorResponse(invalidEmailAssetsResponse, 422, 'VALIDATION_ERROR');
    });

    it('rejects an empty static asset', () => {
        assertErrorResponse(emptyStaticAssetResponse, 400, 'BAD_REQUEST_ERROR');
    });
});

async function putJsonApiResource(path, type, attributes) {
    return await putResource(
        path,
        JSON.stringify({ data: { type, attributes } }),
        JSON_API_CONTENT_TYPE,
    );
}

async function putResource(path, body, contentType) {
    const headers = { authorization: `Bearer ${ publishingToken }` };
    if (contentType) {
        headers['content-type'] = contentType;
    }

    const response = await fetch(`${ getBaseUrl() }/publishing-api/v1/${ path }`, {
        method: 'PUT',
        headers,
        body,
    });

    return {
        status: response.status,
        body: await response.json(),
    };
}

function assertUploadedResource(response, type, size, pathname) {
    assertEqual(201, response.status);
    assertEqual(type, response.body.data.type);
    assertEqual(response.body.data.id, response.body.data.attributes.hash);
    assertEqual(size, response.body.data.attributes.size);

    if (pathname) {
        assertEqual(pathname, response.body.data.attributes.pathname);
    }
}

function assertErrorResponse(response, status, code) {
    assertEqual(status, response.status);
    assertEqual(String(status), response.body.errors[0].status);
    assertEqual(code, response.body.errors[0].code);
}

function byteLength(value) {
    const source = typeof value === 'string' ? value : JSON.stringify(value);
    return new TextEncoder().encode(source).byteLength;
}
