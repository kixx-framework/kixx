import process from 'node:process';
import { assertNonEmptyString } from 'kixx-assert';


/**
 * Returns the configured end-to-end target URL without a trailing slash.
 * @returns {string} Absolute HTTP or HTTPS target URL.
 */
export function getBaseUrl() {
    assertNonEmptyString(process.env.E2E_TESTS_BASE_URL, 'E2E_TESTS_BASE_URL');
    new URL(process.env.E2E_TESTS_BASE_URL);
    return process.env.E2E_TESTS_BASE_URL.replace(/\/$/, '');
}
