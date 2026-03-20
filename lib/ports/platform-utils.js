/**
 * PlatformUtils port — the contract for platform-specific utility functions.
 *
 * Any PlatformUtils implementation must provide UUID generation and cryptographic
 * hashing using the host platform's built-in primitives, so the same application
 * code runs unchanged across Node.js, Cloudflare Workers, Deno, Bun, and other runtimes.
 *
 * ## Invariants
 * - createRandomUUID() MUST return a string conforming to UUID v4 format:
 *   xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx, where x is a lowercase hex digit
 *   and y is one of 8, 9, a, or b
 * - createRandomUUID() MUST return a different value on each call with overwhelming probability
 * - createRandomUUID() MUST NOT throw under normal operating conditions
 * - computeSHA256() MUST return a lowercase hex-encoded SHA-256 digest
 * - computeSHA256() MUST accept a string (UTF-8 encoded) or binary data
 * - computeSHA256() MUST return the same digest for the same input on every call
 * - computeSHA256() MUST NOT throw under normal operating conditions
 *
 * @module ports/platform-utils
 */

/**
 * @typedef {Object} PlatformUtils
 * @property {function(): string} createRandomUUID
 *   Creates and returns a new UUID v4 string.
 * @property {function(string|ArrayBuffer|TypedArray): Promise<string>} computeSHA256
 *   Hashes data using SHA-256 and returns a lowercase hex-encoded digest string.
 *   String inputs are encoded as UTF-8 before hashing.
 */
