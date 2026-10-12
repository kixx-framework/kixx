import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';
import { createPublishingApiToken } from '../test-helpers/publishing-workflows.js';
import { getBaseUrl } from '../test-helpers/target-url.js';
import { createRunPrefix } from './helpers.js';


const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';
const RUN_PREFIX = createRunPrefix();

// These checks fail before any request reaches Release or object business
// logic (media-type and document parsing run ahead of everything else), so
// they carry no storage side effects and always run, including against a
// read-only developer content store.

let publishingToken;
let methodNotAllowedResponse;
let unsupportedMediaTypeResponse;
let malformedDocumentResponse;
let typeMismatchResponse;


describe('Publishing API protocol errors', ({ before, it }) => {

    before(async () => {
        const token = await createPublishingApiToken({
            description: `${ RUN_PREFIX } protocol errors`,
        });
        publishingToken = token.token;

        methodNotAllowedResponse = await request('', { method: 'POST' });
        unsupportedMediaTypeResponse = await request('releases/validation', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ data: { type: 'Release', attributes: {} } }),
        });
        malformedDocumentResponse = await request('releases', {
            method: 'POST',
            headers: { 'content-type': JSON_API_CONTENT_TYPE },
            body: '{"data":',
        });
        typeMismatchResponse = await request('releases', {
            method: 'POST',
            headers: { 'content-type': JSON_API_CONTENT_TYPE },
            body: JSON.stringify({ data: { type: 'NotARelease', attributes: {} } }),
        });
    });

    it('rejects a disallowed method with allowed methods', () => {
        assertErrorResponse(methodNotAllowedResponse, 405, 'METHOD_NOT_ALLOWED_ERROR');
        assertEqual(
            normalizeAllowedMethods('GET'),
            normalizeAllowedMethods(methodNotAllowedResponse.allow),
        );
    });

    it('rejects an unsupported JSON:API media type', () => {
        assertErrorResponse(unsupportedMediaTypeResponse, 415, 'UNSUPPORTED_MEDIA_TYPE_ERROR');
    });

    it('rejects a malformed JSON:API document', () => {
        assertErrorResponse(malformedDocumentResponse, 400, 'BAD_REQUEST_ERROR');
    });

    it('rejects a JSON:API resource type mismatch', () => {
        assertErrorResponse(typeMismatchResponse, 409, 'JsonApiResourceTypeMismatch');
    });
});

async function request(path, options) {
    const response = await fetch(`${ getBaseUrl() }/publishing-api/v1/${ path }`, {
        ...options,
        headers: {
            authorization: `Bearer ${ publishingToken }`,
            ...options.headers,
        },
    });

    return {
        status: response.status,
        allow: response.headers.get('allow'),
        body: await response.json(),
    };
}

function assertErrorResponse(response, status, code) {
    assertEqual(status, response.status);
    assertEqual(String(status), response.body.errors[0].status);
    assertEqual(code, response.body.errors[0].code);
}

function normalizeAllowedMethods(value) {
    return value.split(',').map(method => method.trim()).sort().join(', ');
}
