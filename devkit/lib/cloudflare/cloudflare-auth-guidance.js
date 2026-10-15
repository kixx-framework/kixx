/**
 * Turns a Cloudflare authentication failure into instructions for the user.
 * @module cloudflare-auth-guidance
 */

import UsageError from '../usage-error.js';

const TOKEN_DASHBOARD_URL = 'https://dash.cloudflare.com/profile/api-tokens';

/**
 * Describes what to fix after Cloudflare refuses a request for an
 * authentication reason.
 *
 * The API client establishes whether Cloudflare rejected the token itself or
 * merely refused the request; the caller supplies the files the token could
 * have come from, which the client has no reason to know. Neither half is
 * useful to a user without the other.
 *
 * @param {import('./cloudflare-api-error.js').default} error - Error thrown by the API client
 * @param {string[]} secretsFilepaths - Secrets files searched, home layer first
 * @returns {?string} Guidance to print, or null when the error was not an
 *     authentication failure and this module has nothing to say about it
 */
export function describeCloudflareAuthFailure(error, secretsFilepaths) {
    if (error?.name !== 'CloudflareApiError' || !error.tokenStatus) {
        return null;
    }

    const lines = [];

    if (error.tokenStatus === 'invalid') {
        lines.push('Cloudflare rejected the API token. It is invalid, revoked, or expired.');
        lines.push('');
        lines.push('Replace cloudflare.apiToken in one of these files:');
    } else if (error.tokenStatus === 'valid') {
        lines.push('Cloudflare accepted the API token but refused this request:');
        lines.push(`  ${ error.method } ${ error.url }`);
        lines.push('');
        lines.push(
            'The token is missing a permission, or is not scoped to the account in ' +
            'cloudflare.accountId. Check both in one of these files:',
        );
    } else {
        lines.push(`Cloudflare refused this request with HTTP status ${ error.status }:`);
        lines.push(`  ${ error.method } ${ error.url }`);
        lines.push('');
        lines.push(
            'The API token could not be verified, so the cause is unconfirmed. ' +
            'Check cloudflare.apiToken and cloudflare.accountId in one of these files:',
        );
    }

    for (const filepath of secretsFilepaths ?? []) {
        lines.push(`  ${ filepath }`);
    }

    lines.push('');
    lines.push(`Manage tokens at ${ TOKEN_DASHBOARD_URL }`);
    lines.push('Worker commands require the Account / Workers Scripts / Edit permission.');

    return lines.join('\n');
}

/**
 * Converts a Cloudflare authentication failure into a `UsageError`, so the
 * CLI prints instructions instead of a stack trace. Any other error is
 * returned unchanged.
 * @param {Error} error - Error thrown by a command
 * @param {string[]} secretsFilepaths - Secrets files searched, home layer first
 * @returns {Error} A `UsageError` carrying the guidance, or the original error
 */
export function toCloudflareAuthUsageError(error, secretsFilepaths) {
    const guidance = describeCloudflareAuthFailure(error, secretsFilepaths);

    if (guidance) {
        return new UsageError(guidance, { cause: error });
    }

    return error;
}
