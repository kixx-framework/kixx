import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import CloudflareApiError from '../../../lib/cloudflare/cloudflare-api-error.js';
import UsageError from '../../../lib/usage-error.js';
import { describeCloudflareAuthFailure, toCloudflareAuthUsageError } from '../../../lib/cloudflare/cloudflare-auth-guidance.js';


const SECRETS_FILEPATHS = [
    '/home/user/.kixx/secrets.json',
    '/home/user/project/.kixx/secrets.json',
];

describe('cloudflare/cloudflare-auth-guidance', ({ it }) => {
    it('says nothing about a failure which is not an authentication failure', () => {
        const error = makeError({ status: 404 });

        assertEqual(null, describeCloudflareAuthFailure(error, SECRETS_FILEPATHS));
    });

    it('says nothing about an error from another source', () => {
        const error = new Error('boom');

        assertEqual(null, describeCloudflareAuthFailure(error, SECRETS_FILEPATHS));
    });

    it('tells the user to replace a rejected token', () => {
        const error = makeError({ status: 401, tokenStatus: 'invalid' });

        const guidance = describeCloudflareAuthFailure(error, SECRETS_FILEPATHS);

        assertMatches('Cloudflare rejected the API token', guidance);
        assertMatches('Replace cloudflare.apiToken', guidance);
    });

    it('tells the user to check permissions when the token itself is good', () => {
        const error = makeError({ status: 403, tokenStatus: 'valid' });

        const guidance = describeCloudflareAuthFailure(error, SECRETS_FILEPATHS);

        assertMatches('accepted the API token but refused this request', guidance);
        assertMatches('missing a permission', guidance);
        assertMatches('GET https://api.cloudflare.com/example', guidance);
    });

    it('admits the cause is unconfirmed when the token could not be verified', () => {
        const error = makeError({ status: 401, tokenStatus: 'unknown' });

        const guidance = describeCloudflareAuthFailure(error, SECRETS_FILEPATHS);

        assertMatches('could not be verified', guidance);
        assertMatches('HTTP status 401', guidance);
    });

    // Every branch has to name where the value lives, or the user is left
    // guessing which of the two secrets layers to edit.
    it('names every secrets file for each token status', () => {
        for (const tokenStatus of [ 'invalid', 'valid', 'unknown' ]) {
            const error = makeError({ status: 401, tokenStatus });
            const guidance = describeCloudflareAuthFailure(error, SECRETS_FILEPATHS);

            for (const filepath of SECRETS_FILEPATHS) {
                assertMatches(filepath, guidance);
            }

            assertMatches('https://dash.cloudflare.com/profile/api-tokens', guidance);
        }
    });

    it('renders without secrets filepaths', () => {
        const error = makeError({ status: 401, tokenStatus: 'invalid' });

        const guidance = describeCloudflareAuthFailure(error);

        assert(guidance, 'expected guidance to be rendered');
        assertMatches('Cloudflare rejected the API token', guidance);
    });

    it('converts an auth failure into a UsageError naming the secrets files', () => {
        const error = makeError({ status: 403, tokenStatus: 'valid' });

        const converted = toCloudflareAuthUsageError(error, SECRETS_FILEPATHS);

        assert(converted instanceof UsageError, 'expected a UsageError');
        assertEqual(error, converted.cause);
        for (const filepath of SECRETS_FILEPATHS) {
            assertMatches(filepath, converted.message);
        }
    });

    it('returns any other error unchanged', () => {
        const notAuth = makeError({ status: 404 });
        const other = new Error('boom');

        assertEqual(notAuth, toCloudflareAuthUsageError(notAuth, SECRETS_FILEPATHS));
        assertEqual(other, toCloudflareAuthUsageError(other, SECRETS_FILEPATHS));
    });
});

function makeError(options) {
    const { status, tokenStatus = null } = options;

    return new CloudflareApiError(`Unexpected HTTP status ${ status }`, {
        status,
        method: 'GET',
        url: 'https://api.cloudflare.com/example',
        tokenStatus,
    });
}
