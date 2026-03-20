/**
 * UUIDGenerator port — the contract for generating universally unique identifiers.
 *
 * Any UUIDGenerator implementation must produce version 4 UUIDs suitable for
 * use as document IDs, request correlation tokens, or any other context requiring
 * a globally unique, unpredictable string identifier.
 *
 * ## Invariants
 * - create() MUST return a string conforming to UUID v4 format:
 *   xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx, where x is a lowercase hex digit
 *   and y is one of 8, 9, a, or b
 * - create() MUST return a different value on each call with overwhelming probability
 * - create() MUST NOT throw under normal operating conditions
 *
 * @module ports/uuid-generator
 */

/**
 * @typedef {Object} UUIDGenerator
 * @property {function(): string} createRandomUUID - Creates and returns a new UUID v4 string.
 */
