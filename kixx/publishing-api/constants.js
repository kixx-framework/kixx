// Bumped whenever the Publishing API's wire format changes. Clients compare it
// exactly before any write. Protocol 4 added build write intents (prestage,
// publish), sourceRevision, summary, code, codeFingerprint, force, and
// forceReason; liveSourceRevision on every Build; and CONT-4's required
// provenance.sourceRevision outside development.
export const BUILD_ASSIGNMENT_PROTOCOL_VERSION = 4;
export const MAX_OBJECT_STATUS_IDS = 100;

// The content store's limits, which the content compiler also enforces.
export { MAX_OBJECT_BYTES, MAX_MANIFEST_ENTRIES } from '../content-addressable-store/content-limits.js';
