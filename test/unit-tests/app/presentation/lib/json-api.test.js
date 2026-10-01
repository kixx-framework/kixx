import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { BadRequestError, ValidationError } from '../../../../../src/kixx/errors/mod.js';
import {
    assertAcceptsJsonApi,
    assertStrictJsonApiContentType,
    parseBasicAuthCredentials,
    toJsonApiErrorObjects,
    withErrorSource,
} from '../../../../../src/app/presentation/lib/json-api.js';


function makeRequest(authorization) {
    return { headers: new Headers({ authorization }) };
}

function makeHeaderRequest(headers) {
    return { headers: new Headers(headers) };
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}


describe('json-api', ({ describe }) => {

    describe('parseBasicAuthCredentials', ({ it }) => {
        it('decodes UTF-8 username and password credentials', () => {
            const credentials = parseBasicAuthCredentials(makeRequest('Basic YWPDqTpwYXNzOndvcmQ='));

            assertEqual('acé', credentials.username);
            assertEqual('pass:word', credentials.password);
        });

        it('throws UnauthenticatedError for missing or malformed credentials', () => {
            const missing = catchError(() => parseBasicAuthCredentials(makeRequest()));
            const malformed = catchError(() => parseBasicAuthCredentials(makeRequest('Basic not-base64!')));

            assert(missing, 'expected an error to be thrown');
            assertEqual('UnauthenticatedError', missing.name);
            assert(malformed, 'expected an error to be thrown');
            assertEqual('UnauthenticatedError', malformed.name);
        });
    });

    describe('assertStrictJsonApiContentType', ({ it }) => {
        it('accepts the bare media type and a profile parameter', () => {
            assertStrictJsonApiContentType(makeHeaderRequest({ 'content-type': 'application/vnd.api+json' }));
            assertStrictJsonApiContentType(makeHeaderRequest({ 'content-type': 'Application/Vnd.Api+JSON; profile="https://example.com/p"' }));
        });

        it('rejects other media types and parameters with a header source', () => {
            for (const contentType of [ 'application/json', 'application/vnd.api+json; charset=utf-8', 'application/vnd.api+json; ext="x"' ]) {
                const error = catchError(() => assertStrictJsonApiContentType(makeHeaderRequest({ 'content-type': contentType })));

                assertEqual('UnsupportedMediaTypeError', error.name, contentType);
                assertEqual('Content-Type', error.source.header);
            }

            const missing = catchError(() => assertStrictJsonApiContentType(makeHeaderRequest({})));
            assertEqual('UnsupportedMediaTypeError', missing.name);
        });
    });

    describe('assertAcceptsJsonApi', ({ it }) => {
        it('leaves absent and non-JSON:API Accept headers to the client', () => {
            assertAcceptsJsonApi(makeHeaderRequest({}));
            assertAcceptsJsonApi(makeHeaderRequest({ accept: 'text/html, */*' }));
        });

        it('rejects only when every JSON:API entry has an unsupported parameter', () => {
            assertAcceptsJsonApi(makeHeaderRequest({ accept: 'application/vnd.api+json; ext="x", application/vnd.api+json; q=0.9' }));

            const error = catchError(() => assertAcceptsJsonApi(makeHeaderRequest({ accept: 'application/vnd.api+json; charset=utf-8' })));
            assertEqual('NotAcceptableError', error.name);
            assertEqual('Accept', error.source.header);
        });
    });

    describe('toJsonApiErrorObjects', ({ it }) => {
        it('maps validation entries to escaped attribute pointers', () => {
            const error = new ValidationError('Invalid record');
            error.push('Key is required', 'content.key');
            error.push('Odd name', 'a/b~c');

            const objects = toJsonApiErrorObjects(error);

            assertEqual(2, objects.length);
            assertEqual('422', objects[0].status);
            assertEqual('VALIDATION_ERROR', objects[0].code);
            assertEqual('Key is required', objects[0].detail);
            assertEqual('/data/attributes/content/key', objects[0].source.pointer);
            assertEqual('/data/attributes/a~1b~0c', objects[1].source.pointer);
        });

        it('keeps an object source and exposes only the public message', () => {
            const cause = new Error('internal detail');
            const error = withErrorSource(new BadRequestError('Bad page size', { cause, code: 'Bad' }), { parameter: 'page[size]' });

            const [ object ] = toJsonApiErrorObjects(error);

            assertEqual('400', object.status);
            assertEqual('Bad page size', object.detail);
            assertEqual('page[size]', object.source.parameter);
            assertEqual(false, JSON.stringify(object).includes('internal detail'));
        });
    });
});
