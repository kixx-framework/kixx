import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { parseBasicAuthCredentials } from '../../../../../src/app/presentation/lib/json-api.js';


function makeRequest(authorization) {
    return { headers: new Headers({ authorization }) };
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
});
