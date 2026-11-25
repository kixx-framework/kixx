// Bumped whenever the Publishing API's wire format changes. Clients compare it
// exactly before any write.
export const BUILD_ASSIGNMENT_PROTOCOL_VERSION = 3;
export const MAX_OBJECT_BYTES = 25 * 1024 * 1024;
export const MAX_OBJECT_STATUS_IDS = 100;
export const MAX_MANIFEST_ENTRIES = 10_000;
