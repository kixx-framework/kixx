# Publish Gates

The rules of REQUIREMENTS.md §5.3 that the server can enforce, in one place. The Publishing API runs them for the deploy key, and Studio's in-process publish runs the same function for a user (A9). Import from `kixx/publish-gates/mod.js`.

The server can't see git history. It trusts the commit ids and fingerprints the deploy key holder or Studio sends. The client checks that the commit is pushed, that the tree is clean, and that the commit contains the live commit (CONT-7).

## Intents

Every build write declares one (`BUILD_ASSIGNMENT_INTENTS`):

- **`prestage`** gives a build its code and a Release. It may create the build. A deploy pre-stages the new build id before its code goes live.
- **`publish`** is a content-only publish to a build that already exists.

## The rules

`findBuildAssignmentProblems(assignment, { isDevelopment })` checks the protocol 4 fields and returns `{ message, source }` problems. It never throws for bad input. `source` is relative to the assignment, such as `code.fingerprint`; the Publishing API prefixes `attributes.`. `undefined` and `null` both mean absent.

| Field | `prestage` | `publish` | Rule |
|---|---|---|---|
| `intent` | required | required | `'prestage'` or `'publish'`, in every environment. |
| `sourceRevision` | required outside development | required outside development | A commit id: 40 or 64 lowercase hex. |
| `summary` | optional | optional | A non-empty string, at most 2,000 characters. |
| `code` | required outside development | refused | Exactly `{ revision, fingerprint }`: a commit id and a code fingerprint. |
| `codeFingerprint` | refused | required outside development | A code fingerprint (`/^kxfp[1-9][0-9]*:[0-9a-f]{64}$/`). |
| `force` | optional | optional | A boolean. `true` requires `forceReason`. |
| `forceReason` | only with `force: true` | only with `force: true` | A non-empty string, at most 2,000 characters. |

`releaseId`, `expectedAssignmentId`, and `reason` are the caller's to check. The Publishing API checks them from the request; Studio supplies them from the store.

`findReleaseProvenanceProblems(provenance, { isDevelopment })` is CONT-4 for a new Release: outside development `provenance.sourceRevision` is required, and whenever it is present it must be a commit id. The store's `validateReleaseProvenance()` checks the other provenance fields.

## Assigning through the gates

```js
import { assignReleaseThroughGates } from '../publish-gates/mod.js';
import { isDevelopmentEnvironment } from '../config/environment.js';

const result = await assignReleaseThroughGates(context, store, buildId, {
    intent: 'publish',
    releaseId,
    expectedAssignmentId,
    reason: 'publish',
    actor,                      // the caller's: a user in Studio, the deploy key in the API
    sourceRevision,
    codeFingerprint,
    summary,
}, { isDevelopment: isDevelopmentEnvironment(context.config) });
```

`store` is the `ContentAddressableStore` service. The function:

1. Asserts `releaseId`, `expectedAssignmentId`, `reason`, `actor`, and every key. These are programmer errors (`AssertionError`), never user input.
2. Runs `findBuildAssignmentProblems()` again and throws a `ValidationError` with code `InvalidBuildAssignment` (422) if any remain.
3. For `publish`, reads the build pointer (CONT-6):
   - No pointer: `NotFoundError` `BuildNotFound` (404).
   - The build has no code, outside development: `ConflictError` `BuildCodeUnknown` (409). Pre-stage it with code.
   - The build's fingerprint differs from `codeFingerprint`: `ConflictError` `CodeFingerprintMismatch` (409), naming both values. Deploy the commit's code first.
4. Calls `store.assignRelease()` with `releaseId`, `expectedAssignmentId`, `reason`, `actor`, `sourceRevision`, `summary`, `forceReason` (only when `force` is true), and `code` (pre-stage only), leaving absent values out.

The store then adds its own refusals: `ReleaseNotFound` (404), `BuildPointerConflict` (409; the Publishing API maps it to 412), and `BuildCodeMismatch` (409) when a pre-stage names code other than the build's. A refusal changes nothing.

Reading the pointer and then assigning is safe. A build's code is set once, so its fingerprint can't change in between. A build without code exists only in development. A pointer moved in between fails `expectedAssignmentId`.

## `force`

`force: true` with a `forceReason` says the caller overrode its CONT-7 ancestry check. The gate checks nothing differently: it only records `forceReason` on the Activation. It never bypasses CONT-6 or the pre-stage requirement. A fingerprint mismatch is waited out with a deploy, not forced (STU-19). So a pointer-only rollback can't go back past a code deploy; redeploy the older code instead.

The gate accepts `force` from any caller. Studio checks that only Developers may force.

## Development

`isDevelopmentEnvironment(config)` from `kixx/config/environment.js` is true only when `config.environment` is `'development'`. In development nothing new is required, but a present value is still checked. A content-only publish compares fingerprints only when both the build's code and the request's `codeFingerprint` are present, so a build with no code takes content-only publishes.

## Studio

Studio's publish (STU-18 step 5) calls `findReleaseProvenanceProblems()` before `createRelease()`, then `assignReleaseThroughGates()` with a user actor. On `CodeFingerprintMismatch` it shows "deploy pending" and retries once the running build's code matches (STU-19). It reads the live commit for its ancestry check from the build pointer: `(await store.getBuildPointer(context, buildId)).liveSourceRevision`.

Fingerprints come from `computeCodeFingerprint()` in `kixx/code-fingerprint/` (see its README).
