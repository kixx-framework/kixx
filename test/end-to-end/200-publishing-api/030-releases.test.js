import process from 'node:process';
import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import { CONTENT_CONTRACT_VERSION } from '../../../src/kixx/content-addressable-store/content-addressable-store.js';
import {
    createPublishingApiToken,
    createRelease,
    createReleaseOrThrow,
    getRelease,
    getReleaseManifest,
    listReleases,
    uploadObject,
    validateRelease,
} from '../test-helpers/publishing-workflows.js';
import { createRunPrefix, createRunScopedPathname } from './helpers.js';


const IS_DEVELOPMENT_TARGET = process.env.E2E_TESTS_TARGET === 'development';
const RUN_PREFIX = createRunPrefix();

let publishingToken;

// "Fails on a missing object" needs no fixture upload at all, so it is safe
// to run even against a read-only developer content store.
let missingObjectResponse;


describe('Publishing API Release creation', ({ before, it }) => {

    before(async () => {
        const token = await createPublishingApiToken({ description: `${ RUN_PREFIX } releases` });
        publishingToken = token.token;

        missingObjectResponse = await createRelease(publishingToken, {
            staticAssets: {
                [createRunScopedPathname(RUN_PREFIX, 'missing.css')]: { objectId: 'zzzzzzzzzzzzzzzzzzzzzzzzzz', size: 1 },
            },
        });
    });

    it('reports every missing object without creating anything', () => {
        assertEqual(422, missingObjectResponse.status);
        assertEqual('MissingContentObjects', missingObjectResponse.body.errors[0].code);
    });
});

describe('Publishing API Release verification', ({ before, it }) => {
    const staticAssetPathname = createRunScopedPathname(RUN_PREFIX, 'verified/site.css');

    let successResponse;
    let wrongSizeResponse;
    let badTemplateResponse;
    let validationResponse;
    let validationReadBackResponse;
    let inlineInValidationResponse;
    let idempotentManifest;
    let firstCreate;
    let secondCreate;
    let listResponse;
    let readResponse;
    let manifestResponse;

    before(async () => {
        const token = await createPublishingApiToken({ description: `${ RUN_PREFIX } release verification` });
        publishingToken = token.token;

        const staticAsset = await uploadObject(publishingToken, `${ RUN_PREFIX } body { color: black; }`);
        successResponse = await createRelease(publishingToken, {
            staticAssets: { [staticAssetPathname]: { objectId: staticAsset.objectId, size: staticAsset.size } },
        }, { sourceRevision: 'e2e-fixture', message: 'Verified release fixture' });

        const shortObject = await uploadObject(publishingToken, 'abc');
        wrongSizeResponse = await createRelease(publishingToken, {
            staticAssets: { [createRunScopedPathname(RUN_PREFIX, 'wrong-size.css')]: { objectId: shortObject.objectId, size: 99 } },
        });

        const unresolvedBaseTemplates = await uploadObject(
            publishingToken,
            JSON.stringify([ { id: 'base.html', source: '{{> missing-base }}' } ]),
        );
        badTemplateResponse = await createRelease(publishingToken, {
            baseTemplates: { objectId: unresolvedBaseTemplates.objectId, size: unresolvedBaseTemplates.size },
        });

        const validationObject = await uploadObject(publishingToken, `${ RUN_PREFIX } validation-only content`);
        const validationManifest = {
            staticAssets: {
                [createRunScopedPathname(RUN_PREFIX, 'validation-only.css')]: {
                    objectId: validationObject.objectId,
                    size: validationObject.size,
                },
            },
        };
        validationResponse = await validateRelease(publishingToken, validationManifest);
        validationReadBackResponse = await getRelease(publishingToken, validationResponse.body.data.id);

        inlineInValidationResponse = await validateRelease(publishingToken, {
            staticAssets: { [createRunScopedPathname(RUN_PREFIX, 'inline.css')]: { content: 'body{}', mediaType: 'text/css' } },
        });

        idempotentManifest = {
            staticAssets: { [staticAssetPathname]: { objectId: staticAsset.objectId, size: staticAsset.size } },
        };
        const provenance = { sourceRevision: 'e2e-fixture', message: 'Verified release fixture' };
        firstCreate = await createReleaseOrThrow(publishingToken, idempotentManifest, provenance);
        secondCreate = await createReleaseOrThrow(publishingToken, idempotentManifest, provenance);

        listResponse = await listReleases(publishingToken);
        readResponse = await getRelease(publishingToken, firstCreate.id);
        manifestResponse = await getReleaseManifest(publishingToken, firstCreate.id);
    });

    it('creates a Release when every reference verifies', () => {
        assertEqual(201, successResponse.status);
        assertEqual(1, successResponse.body.data.attributes.objectCount);
        assertEqual(CONTENT_CONTRACT_VERSION, successResponse.body.data.attributes.contractVersion);
        assertEqual('e2e-fixture', successResponse.body.data.attributes.provenance.sourceRevision);
    });

    it('rejects a claimed size that disagrees with the stored size', () => {
        assertEqual(409, wrongSizeResponse.status);
        assertEqual('ObjectSizeMismatch', wrongSizeResponse.body.errors[0].code);
    });

    it('rejects a template that references an unresolvable partial', () => {
        assertEqual(422, badTemplateResponse.status);
        assertEqual('InvalidReleaseManifest', badTemplateResponse.body.errors[0].code);
    });

    it('validates without persisting a Release record', () => {
        assertEqual(200, validationResponse.status);
        assert(validationResponse.body.data.id);
        assertEqual(404, validationReadBackResponse.status);
        assertEqual('ReleaseNotFound', validationReadBackResponse.body.errors[0].code);
    });

    it('rejects inline content during validation', () => {
        assertEqual(400, inlineInValidationResponse.status);
        assertEqual('BAD_REQUEST_ERROR', inlineInValidationResponse.body.errors[0].code);
    });

    it('creates identical content idempotently', () => {
        assertEqual(firstCreate.id, secondCreate.id);
    });

    it('lists, reads, and returns the manifest for a created Release', () => {
        assertEqual(200, listResponse.status);
        assert(listResponse.body.data.some((resource) => resource.id === firstCreate.id));

        assertEqual(200, readResponse.status);
        assertEqual(firstCreate.id, readResponse.body.data.id);

        assertEqual(200, manifestResponse.status);
        assertEqual(
            JSON.stringify(idempotentManifest),
            JSON.stringify(manifestResponse.body.data.attributes.manifest),
        );
    });
}, { disabled: IS_DEVELOPMENT_TARGET });
