import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import {
    createPublishingApiToken,
    uploadBaseTemplates,
    uploadEmailAssets,
    uploadGlobalTemplatePartials,
    uploadPageIncludes,
    uploadPageMetadata,
    uploadPagePartials,
    uploadPageTemplate,
    uploadStaticAsset,
} from '../test-helpers/publishing-workflows.js';
import { getBaseUrl } from '../test-helpers/target-url.js';
import {
    createRunPrefix,
    createRunScopedBuildId,
    createRunScopedPathname,
} from './helpers.js';


const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';
const RUN_PREFIX = createRunPrefix();
const BUILD_ID = createRunScopedBuildId(RUN_PREFIX, 'index-reads');
const STATIC_ASSET_PATHNAME = createRunScopedPathname(RUN_PREFIX, 'assets/site.css');
const PAGE_PATHNAME = createRunScopedPathname(RUN_PREFIX, 'pages/example');
const PAGE_TEMPLATE_PATHNAME = createRunScopedPathname(RUN_PREFIX, 'pages/example/page.html');
const EMAIL_PATHNAME = createRunScopedPathname(RUN_PREFIX, 'emails/welcome');

let publishingToken;
let expectedReferences;
let getResponses;
let headResponses;
let missingReferenceResponse;


describe('Publishing API published resource references', ({ before, it }) => {

    before(async () => {
        const token = await createPublishingApiToken({
            description: `${ RUN_PREFIX } index reads`,
        });
        publishingToken = token.token;

        const references = await uploadFixture();
        await publishFixture(references);

        expectedReferences = [
            {
                path: `index/static-asset/${ STATIC_ASSET_PATHNAME }`,
                pathname: STATIC_ASSET_PATHNAME,
                reference: references.staticAsset,
                type: 'StaticAsset',
            },
            {
                path: 'index/global-template-partials',
                reference: references.globalTemplatePartials,
                type: 'GlobalTemplatePartials',
            },
            {
                path: 'index/base-templates',
                reference: references.baseTemplates,
                type: 'BaseTemplates',
            },
            {
                path: `index/page-metadata/${ PAGE_PATHNAME }`,
                pathname: PAGE_PATHNAME,
                reference: references.pageMetadata,
                type: 'PageMetadata',
            },
            {
                path: `index/page-partials/${ PAGE_PATHNAME }`,
                pathname: PAGE_PATHNAME,
                reference: references.pagePartials,
                type: 'PagePartials',
            },
            {
                path: `index/page-includes/${ PAGE_PATHNAME }`,
                pathname: PAGE_PATHNAME,
                reference: references.pageIncludes,
                type: 'PageIncludes',
            },
            {
                path: `index/page-templates/${ PAGE_TEMPLATE_PATHNAME }`,
                pathname: PAGE_TEMPLATE_PATHNAME,
                reference: references.pageTemplate,
                type: 'PageTemplate',
            },
            {
                path: `index/emails/${ EMAIL_PATHNAME }`,
                pathname: EMAIL_PATHNAME,
                reference: references.emailAssets,
                type: 'EmailAssets',
            },
        ];

        getResponses = await Promise.all(expectedReferences.map(async ({ path }) => await getReference(path)));
        headResponses = await Promise.all(expectedReferences.map(async ({ path }) => await getReference(path, 'HEAD')));
        missingReferenceResponse = await getReference(`index/static-asset/${ createRunScopedPathname(RUN_PREFIX, 'assets/missing.css') }`);
    });

    it('gets every published reference', () => {
        for (let index = 0; index < expectedReferences.length; index += 1) {
            assertReferenceResponse(getResponses[index], expectedReferences[index]);
        }
    });

    it('returns matching headers and no body for every HEAD reference', () => {
        for (const response of headResponses) {
            assertEqual(200, response.status);
            assertEqual(`${ JSON_API_CONTENT_TYPE }; charset=utf-8`, response.contentType);
            assertEqual('', response.body);
        }
    });

    it('rejects an unpublished resource', () => {
        assertEqual(404, missingReferenceResponse.status);
        assertEqual('404', missingReferenceResponse.body.errors[0].status);
        assertEqual('NOT_FOUND_ERROR', missingReferenceResponse.body.errors[0].code);
    });
});

async function uploadFixture() {
    const staticAsset = await uploadStaticAsset(publishingToken, STATIC_ASSET_PATHNAME, 'body { color: black; }');
    const globalTemplatePartials = await uploadGlobalTemplatePartials(publishingToken, [
        { id: 'header', source: '<header>Header</header>' },
    ]);
    const baseTemplates = await uploadBaseTemplates(publishingToken, [
        { id: 'base', source: '<main>{{content}}</main>' },
    ]);
    const pageMetadata = await uploadPageMetadata(publishingToken, PAGE_PATHNAME, { title: 'Index reads' });
    const pagePartials = await uploadPagePartials(publishingToken, PAGE_PATHNAME, [
        { id: 'hero', source: '<section>Hero</section>' },
    ]);
    const pageIncludes = await uploadPageIncludes(publishingToken, PAGE_PATHNAME, {
        footer: '<footer>Footer</footer>',
    });
    const pageTemplate = await uploadPageTemplate(publishingToken, PAGE_TEMPLATE_PATHNAME, '<article>{{title}}</article>');
    const emailAssets = await uploadEmailAssets(publishingToken, EMAIL_PATHNAME, {
        htmlTemplate: { id: 'welcome.html', source: '<h1>Welcome</h1>' },
    });

    return {
        staticAsset,
        globalTemplatePartials,
        baseTemplates,
        pageMetadata,
        pagePartials,
        pageIncludes,
        pageTemplate,
        emailAssets,
    };
}

async function publishFixture(references) {
    const response = await fetch(`${ getBaseUrl() }/publishing-api/v1/index/closure`, {
        method: 'PUT',
        headers: {
            authorization: `Bearer ${ publishingToken }`,
            'content-type': JSON_API_CONTENT_TYPE,
        },
        body: JSON.stringify({
            data: {
                type: 'ContentTree',
                attributes: {
                    buildId: BUILD_ID,
                    staticAssets: { [STATIC_ASSET_PATHNAME]: references.staticAsset },
                    globalTemplatePartials: references.globalTemplatePartials,
                    baseTemplates: references.baseTemplates,
                    pages: {
                        [PAGE_PATHNAME]: {
                            metadata: references.pageMetadata,
                            partials: references.pagePartials,
                            includes: references.pageIncludes,
                            template: { pathname: PAGE_TEMPLATE_PATHNAME, ...references.pageTemplate },
                        },
                    },
                    emails: { [EMAIL_PATHNAME]: references.emailAssets },
                },
            },
        }),
    });

    if (response.status !== 201) {
        throw new Error(`publishFixture: PUT /publishing-api/v1/index/closure returned ${ response.status }, expected 201`);
    }
}

async function getReference(path, method = 'GET') {
    const response = await fetch(`${ getBaseUrl() }/publishing-api/v1/${ path }`, {
        method,
        headers: { authorization: `Bearer ${ publishingToken }` },
    });

    return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        body: await response.text(),
    };
}

function assertReferenceResponse(response, expected) {
    assertEqual(200, response.status);
    assertEqual(`${ JSON_API_CONTENT_TYPE }; charset=utf-8`, response.contentType);

    const { data } = JSON.parse(response.body);
    assertEqual(expected.type, data.type);
    assertEqual(expected.reference.hash, data.id);
    assertEqual(expected.reference.hash, data.attributes.hash);
    assertEqual(expected.reference.size, data.attributes.size);

    if (expected.pathname) {
        assertEqual(expected.pathname, data.attributes.pathname);
    }
}
