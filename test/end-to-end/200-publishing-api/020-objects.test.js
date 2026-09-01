import process from 'node:process';
import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import { hashBlob } from '../../../src/kixx/content-addressable-store/addressing.js';
import {
    createPublishingApiToken,
    getObjectStatus,
    putObject,
    uploadObject,
} from '../test-helpers/publishing-workflows.js';
import { createRunPrefix } from './helpers.js';


const IS_DEVELOPMENT_TARGET = process.env.E2E_TESTS_TARGET === 'development';
const RUN_PREFIX = createRunPrefix();

let publishingToken;
let firstUploadResponse;
let repeatedUploadResponse;
let statusResponse;
let unstoredObjectId;
let mismatchResponse;
let mismatchObjectId;
let mismatchActualStatusResponse;


describe('Publishing API object storage', ({ before, it }) => {

    before(async () => {
        const token = await createPublishingApiToken({
            description: `${ RUN_PREFIX } object storage`,
        });
        publishingToken = token.token;

        const content = `${ RUN_PREFIX } object content`;
        firstUploadResponse = await uploadObject(publishingToken, content);
        repeatedUploadResponse = await uploadObject(publishingToken, content);

        // A valid-looking address the store was never asked to store.
        unstoredObjectId = 'zzzzzzzzzzzzzzzzzzzzzzzzzz';
        statusResponse = await getObjectStatus(publishingToken, [
            firstUploadResponse.objectId,
            firstUploadResponse.objectId,
            unstoredObjectId,
        ]);

        const mismatchedBody = `${ RUN_PREFIX } bytes that do not match the route id`;
        mismatchObjectId = 'aaaaaaaaaaaaaaaaaaaaaaaaaa';
        mismatchResponse = await putObject(publishingToken, mismatchObjectId, mismatchedBody);
        const mismatchedBodyActualId = await hashBlob(mismatchedBody);
        mismatchActualStatusResponse = await getObjectStatus(publishingToken, [ mismatchedBodyActualId ]);
    });

    it('stores a new object as 201', () => {
        assertEqual(201, firstUploadResponse.status);
        assert(firstUploadResponse.size > 0);
    });

    it('reports an already-stored object as 200 with the same size', () => {
        assertEqual(200, repeatedUploadResponse.status);
        assertEqual(firstUploadResponse.size, repeatedUploadResponse.size);
    });

    it('deduplicates ids and reports only what is stored', () => {
        assertEqual(200, statusResponse.status);
        const ids = statusResponse.body.data.map((resource) => resource.id);
        assertEqual(1, ids.filter((id) => id === firstUploadResponse.objectId).length);
        assert(!ids.includes(unstoredObjectId));
    });

    it('rejects bytes that do not match the route object id', () => {
        assertEqual(422, mismatchResponse.status);
        assertEqual('ObjectIdMismatch', mismatchResponse.body.errors[0].code);
    });

    it('stores nothing when the uploaded bytes mismatch the route id', () => {
        assertEqual(200, mismatchActualStatusResponse.status);
        assertEqual(0, mismatchActualStatusResponse.body.data.length);
    });
}, { disabled: IS_DEVELOPMENT_TARGET });
