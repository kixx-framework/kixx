import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { createPublishingApiToken } from '../../../../src/app/transaction-scripts/publishing-api-tokens/create-publishing-api-token.js';


const GRANTING_USER_ID = 'admin-1';
const TOKEN = 'kxpat_one-time-secret';


describe('createPublishingApiToken Transaction Script', ({ it }) => {
    it('mints a token from the validated form and returns its one-time credentials', async () => {
        const harness = makeHarness();
        const result = await createPublishingApiToken(
            harness.context,
            harness.form,
            GRANTING_USER_ID,
        );
        const call = harness.calls.createToken[0];

        assertEqual(1, harness.calls.collectionAccess);
        assertEqual('PublishingApiToken', harness.calls.collectionNames[0]);
        assertEqual(1, harness.calls.formToJSON);
        assertEqual(1, harness.calls.createToken.length);
        assertEqual(harness.context, call.context);
        assertEqual(GRANTING_USER_ID, call.args.createdBy);
        assertEqual(harness.formValues.roles, call.args.roles);
        assertEqual(harness.formValues.description, call.args.description);
        assertEqual(harness.formValues.timeToLiveSeconds, call.args.ttlSeconds);
        assertEqual(
            'id,token,roles,description,createdBy,tokenCreationDate,tokenExpirationDate',
            Object.keys(result).join(','),
        );
        assertEqual('token-hash', result.id);
        assertEqual(TOKEN, result.token);
        assertEqual(harness.recordValues.roles, result.roles);
        assertEqual(harness.recordValues.description, result.description);
        assertEqual(harness.recordValues.createdBy, result.createdBy);
        assertEqual(harness.recordValues.tokenCreationDate, result.tokenCreationDate);
        assertEqual(harness.recordValues.tokenExpirationDate, result.tokenExpirationDate);
    });

    it('wraps token creation failures as unexpected errors with their cause', async () => {
        const cause = new Error('document store unavailable');
        const harness = makeHarness({ createError: cause });
        const caught = await catchAsyncError(() => {
            return createPublishingApiToken(
                harness.context,
                harness.form,
                GRANTING_USER_ID,
            );
        });

        assert(caught, 'expected an error to be thrown');
        assertEqual('AssertionError', caught.name);
        assertEqual('Unexpected error while creating a publishing API token', caught.message);
        assertEqual(cause, caught.cause);
        assertEqual(1, harness.calls.createToken.length);
        assertEqual(0, harness.calls.recordGet.length);
    });
});

function makeHarness(options) {
    const {
        createError = null,
        formValues = {
            roles: [ 'Editor' ],
            description: 'Deployment publisher',
            timeToLiveSeconds: 3600,
        },
        recordValues = {
            roles: [ 'Editor' ],
            description: 'Deployment publisher',
            createdBy: GRANTING_USER_ID,
            tokenCreationDate: '2026-07-25T12:00:00.000Z',
            tokenExpirationDate: '2026-07-25T13:00:00.000Z',
        },
    } = options ?? {};
    const calls = {
        collectionAccess: 0,
        collectionNames: [],
        createToken: [],
        formToJSON: 0,
        recordGet: [],
    };
    const form = {
        toJSON() {
            calls.formToJSON += 1;
            return formValues;
        },
    };
    const record = {
        id: 'token-hash',
        get(name) {
            calls.recordGet.push(name);
            return recordValues[name];
        },
    };
    const collection = {
        async createToken(context, args) {
            calls.createToken.push({ context, args });
            if (createError) {
                throw createError;
            }
            return { token: TOKEN, record };
        },
    };
    const context = {
        getCollection(name) {
            calls.collectionAccess += 1;
            calls.collectionNames.push(name);
            return collection;
        },
    };

    return {
        context,
        calls,
        form,
        formValues,
        recordValues,
    };
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
