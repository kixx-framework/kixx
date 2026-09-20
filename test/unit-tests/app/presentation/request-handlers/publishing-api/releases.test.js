import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import ServerResponse from '../../../../../../src/kixx/http-router/server-response.js';
import { ValidationError } from '../../../../../../src/kixx/errors/mod.js';
import { createRelease, validateRelease } from '../../../../../../src/app/presentation/request-handlers/publishing-api/releases.js';
import { JSON_API_CONTENT_TYPE } from '../../../../../../src/app/presentation/lib/json-api.js';


function makeRequest(manifest) {
    return {
        getContentMediaType: () => JSON_API_CONTENT_TYPE,
        json: async () => ({ data: { type: 'Release', attributes: { manifest } } }),
    };
}

describe('Publishing API Releases', ({ it }) => {

    it('rejects inline references without storing objects', async () => {
        let createCalls = 0;
        let validationCalls = 0;
        let objectWrites = 0;
        const store = {
            async putObject() {
                objectWrites += 1;
            },
            async createRelease() {
                createCalls += 1;
            },
            async validateRelease() {
                validationCalls += 1;
            },
        };
        const context = {
            user: { id: 'token-1' },
            getService: () => store,
        };
        const request = makeRequest({
            staticAssets: { '/site.txt': { content: 'hi', mediaType: 'text/plain' } },
        });
        const errors = [];
        for (const handler of [ createRelease, validateRelease ]) {
            try {
                await handler(context, request, new ServerResponse());
            } catch (error) {
                errors.push(error);
            }
        }

        assertEqual(2, errors.length);
        errors.forEach((error) => {
            assertEqual('ValidationError', error.name);
            assertEqual('InvalidReleaseManifest', error.code);
        });
        assertEqual(0, createCalls);
        assertEqual(0, validationCalls);
        assertEqual(0, objectWrites);
    });

    it('enforces the manifest-entry limit before either release operation', async () => {
        const manifest = {
            staticAssets: Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [
                `/asset-${ index }.css`,
                { objectId: 'aaaaaaaaaaaaaaaaaaaaaaaaaa', size: 0 },
            ])),
        };
        const context = {
            user: { id: 'token-1' },
            getService: () => ({
                createRelease: async () => assert(false),
                validateRelease: async () => assert(false),
            }),
        };

        for (const handler of [ createRelease, validateRelease ]) {
            let error;
            try {
                await handler(context, makeRequest(manifest), new ServerResponse());
            } catch (cause) {
                error = cause;
            }
            assert(error);
            assertEqual('BadRequestError', error.name);
        }
    });

    it('turns malformed manifests into expected validation errors', async () => {
        const context = {
            user: { id: 'token-1' },
            getService: () => ({ putObject: async () => {} }),
        };
        let error;
        try {
            await createRelease(context, makeRequest({ staticAssets: 'wrong' }), new ServerResponse());
        } catch (cause) {
            error = cause;
        }

        assert(error);
        assertEqual('ValidationError', error.name);
        assertEqual(true, error.expected);
    });

    it('classifies missing stored objects for the public API', async () => {
        const cause = new ValidationError('The Release content is invalid');
        cause.push('Object "zzzzzzzzzzzzzzzzzzzzzzzzzz" is missing', '/site.css');
        const context = {
            user: { id: 'token-1' },
            getService: () => ({
                putObject: async () => {},
                createRelease: async () => {
                    throw cause;
                },
            }),
            getCollection: () => ({}),
        };
        let error;
        try {
            await createRelease(context, makeRequest({
                staticAssets: {
                    '/site.css': { objectId: 'zzzzzzzzzzzzzzzzzzzzzzzzzz', size: 1 },
                },
            }), new ServerResponse());
        } catch (caught) {
            error = caught;
        }

        assert(error);
        assertEqual('ValidationError', error.name);
        assertEqual('MissingContentObjects', error.code);
        assertEqual(cause, error.cause);
        assertEqual('/site.css', error.errors[0].source);
    });
});
