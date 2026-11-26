// Bumped whenever the Publishing API's wire format changes. Clients compare it
// exactly before any write.
export const BUILD_ASSIGNMENT_PROTOCOL_VERSION = 3;
export const MAX_OBJECT_STATUS_IDS = 100;

// The content store's limits, which the content compiler also enforces.
export { MAX_OBJECT_BYTES, MAX_MANIFEST_ENTRIES } from '../content-addressable-store/content-limits.js';
