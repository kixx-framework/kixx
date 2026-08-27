import { describe } from 'kixx-test';
import { assertEqual, assertGreaterThan } from 'kixx-assert';
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
const BUILD_ID = createRunScopedBuildId(RUN_PREFIX, 'closure');
const STATIC_ASSET_PATHNAME = createRunScopedPathname(RUN_PREFIX, 'assets/site.css');
const PAGE_PATHNAME = createRunScopedPathname(RUN_PREFIX, 'pages/example');
const PAGE_TEMPLATE_PATHNAME = createRunScopedPathname(RUN_PREFIX, 'pages/example/page.html');
const EMAIL_PATHNAME = createRunScopedPathname(RUN_PREFIX, 'emails/welcome');

let publishingToken;
let firstClosureResponse;
let repeatedClosureResponse;
let staticAssetReference;
let pageTemplateReference;
let staticAssetResponse;
let pageTemplateResponse;


describe('Publishing API content-tree closure workflow', ({ before, it }) => {

    before(async () => {
        const token = await createPublishingApiToken({
            description: `${ RUN_PREFIX } closure workflow`,
        });
        publishingToken = token.token;

        const references = await uploadFixture();
        const contentTree = createContentTree(references);

        staticAssetReference = references.staticAsset;
        pageTemplateReference = references.pageTemplate;
        firstClosureResponse = await publishContentTree(contentTree);
        repeatedClosureResponse = await publishContentTree(contentTree);
        staticAssetResponse = await getPublishedReference(`index/static-asset/${ STATIC_ASSET_PATHNAME }`);
        pageTemplateResponse = await getPublishedReference(`index/page-templates/${ PAGE_TEMPLATE_PATHNAME }`);
    });

    it('publishes the complete content tree', () => {
        assertClosureResponse(firstClosureResponse);
    });

    it('publishes the same closure hash when repeated', () => {
        assertClosureResponse(repeatedClosureResponse);
        assertEqual(firstClosureResponse.body.data.id, repeatedClosureResponse.body.data.id);
        assertEqual(firstClosureResponse.body.data.attributes.hash, repeatedClosureResponse.body.data.attributes.hash);
    });

    it('makes closure references available through the published index', () => {
        assertPublishedReference(staticAssetResponse, 'StaticAsset', STATIC_ASSET_PATHNAME, staticAssetReference);
        assertPublishedReference(pageTemplateResponse, 'PageTemplate', PAGE_TEMPLATE_PATHNAME, pageTemplateReference);
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
    const pageMetadata = await uploadPageMetadata(publishingToken, PAGE_PATHNAME, { title: 'Closure workflow' });
    const pagePartials = await uploadPagePartials(publishingToken, PAGE_PATHNAME, [
        { id: 'hero', source: '<section>Hero</section>' },
    ]);
    const pageIncludes = await uploadPageIncludes(publishingToken, PAGE_PATHNAME, {
        footer: '<footer>Footer</footer>',
    });
    const pageTemplate = await uploadPageTemplate(publishingToken, PAGE_TEMPLATE_PATHNAME, '<article>{{title}}</article>');
    const emailAssets = await uploadEmailAssets(publishingToken, EMAIL_PATHNAME, {
        htmlTemplate: { id: 'welcome.html', source: '<h1>Welcome</h1>' },
        textTemplate: { id: 'welcome.txt', source: 'Welcome' },
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

function createContentTree(references) {
    return {
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
    };
}

async function publishContentTree(contentTree) {
    const response = await fetch(`${ getBaseUrl() }/publishing-api/v1/index/closure`, {
        method: 'PUT',
        headers: {
            authorization: `Bearer ${ publishingToken }`,
            'content-type': JSON_API_CONTENT_TYPE,
        },
        body: JSON.stringify({ data: { type: 'ContentTree', attributes: contentTree } }),
    });

    return {
        status: response.status,
        body: await response.json(),
    };
}

async function getPublishedReference(path) {
    const response = await fetch(`${ getBaseUrl() }/publishing-api/v1/${ path }`, {
        headers: { authorization: `Bearer ${ publishingToken }` },
    });

    return {
        status: response.status,
        body: await response.json(),
    };
}

function assertClosureResponse(response) {
    assertEqual(201, response.status);
    assertEqual('ContentTree', response.body.data.type);
    assertEqual(BUILD_ID, response.body.data.attributes.buildId);
    assertEqual(response.body.data.id, response.body.data.attributes.hash);
    assertGreaterThan(0, response.body.data.attributes.nodeCount);
}

function assertPublishedReference(response, type, pathname, reference) {
    assertEqual(200, response.status);
    assertEqual(type, response.body.data.type);
    assertEqual(reference.hash, response.body.data.id);
    assertEqual(reference.hash, response.body.data.attributes.hash);
    assertEqual(reference.size, response.body.data.attributes.size);
    assertEqual(pathname, response.body.data.attributes.pathname);
}
