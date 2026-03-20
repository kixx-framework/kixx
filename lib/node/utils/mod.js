/**
 * Node.js utility functions — platform-specific utilities using Node.js built-in APIs.
 *
 * @module node-utils
 */
import { randomUUID } from 'node:crypto';


/**
 * Creates a new UUID v4.
 *
 * @see {import('../../ports/uuid-generator.js').UUIDGenerator} UUIDGenerator port
 * @public
 * @returns {string}
 */
export function createRandomUUID() {
    return randomUUID();
}
