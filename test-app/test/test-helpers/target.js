import process from 'node:process';
import { assertNonEmptyString, isNonEmptyString } from 'kixx-assert';


/**
 * Returns the integration target's base URL without a trailing slash.
 * @returns {string} Absolute HTTP or HTTPS target URL.
 * @throws {AssertionError} When INTEGRATION_TESTS_BASE_URL is not set
 */
export function getBaseUrl() {
    assertNonEmptyString(process.env.INTEGRATION_TESTS_BASE_URL, 'INTEGRATION_TESTS_BASE_URL');
    return process.env.INTEGRATION_TESTS_BASE_URL.replace(/\/$/, '');
}

/**
 * Returns the target's deploy key from INTEGRATION_TESTS_DEPLOY_KEY.
 *
 * The key is a secret. Send it only in a request's Authorization header, and
 * never print it, log it, or put it in an assertion message.
 *
 * @returns {string|null} The deploy key, or null when none is set.
 */
export function getDeployKey() {
    const deployKey = process.env.INTEGRATION_TESTS_DEPLOY_KEY;
    return isNonEmptyString(deployKey) ? deployKey : null;
}
