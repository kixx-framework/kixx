# Cloudflare fixed-length stream error normalization

## Implementation Approach

Normalize Cloudflare `FixedLengthStream` byte-count failures at the platform
adapter boundary, where the runtime-specific error name and message are known.
`putExactLengthStream()` will continue awaiting both the request-body producer
and R2 consumer with `Promise.allSettled()`, but it will inspect rejections from
both sides before choosing what to throw. A narrowly-scoped predicate will
recognize only the Cloudflare underflow and overflow `TypeError` signatures and
wrap the matching cause in an `OperationalError` whose code is
`ObjectContentLengthMismatch`. Unrelated request-stream and R2 failures will
retain the existing generic storage-failure path.

Cloudflare-specific unit tests will model the runtime behavior missing from the
current plain `TransformStream` stand-in. They will exercise mismatch errors
surfacing from both the producer and R2 consumer promises, verify the stable
adapter error contract and preserved cause, and prove that unrelated R2 errors
are not mislabeled. The existing end-to-end coverage remains unchanged.

## Tasks

### Task CFLSE-1: Normalize Cloudflare fixed-length byte-count failures

**Status:** Complete
**Depends on:** None
**Documentation:** `README.md`; `src/docs/code-style-guide.md`;
`src/docs/code-documentation-guide.md`; `src/docs/server-error-handling.md`;
`src/plugins/README.md`; `src/kixx/object-store/object-store-interface.js`
(`Bodies and streaming`, `Errors`, and `ObjectPutOptions`);
`test/unit-tests/README.md` (`Setup Patterns`, `Shared Conformance Suites`, and
`Error and Rejection Tests`).

**Objective**

Make Cloudflare streamed writes report a genuine `FixedLengthStream` underflow
or overflow as `ObjectContentLengthMismatch`, regardless of whether Workers
rejects the producer pipe or the R2 consumer. This restores the existing
transaction-script translation to `FileContentLengthMismatch` and HTTP 400
without disguising unrelated storage failures as bad client input.

**Scope**

- In: Cloudflare object-store rejection classification; the documented exact
  content-length error contract; Cloudflare-specific unit coverage for both
  promise rejection paths and unrelated R2 failures.
- Out: Node object-store behavior; transaction-script or presentation-layer
  changes; request form validation; new or modified end-to-end tests; changes
  to Cloudflare deployment configuration.

**Design and invariants**

- Keep byte-length enforcement and Cloudflare runtime error normalization in
  `plugins/cloudflare-object-store`; application code must remain
  platform-neutral.
- Continue using `Promise.allSettled()` so both the producer and R2 consumer
  finish settling and neither rejection becomes unhandled.
- Examine both settled results for a fixed-length mismatch before propagating
  another failure. A recognized mismatch must become an `OperationalError`
  with code `ObjectContentLengthMismatch` and the original native error as its
  `cause`, whether the native rejection came from the producer or consumer.
- Recognize only Cloudflare's fixed-length underflow and overflow `TypeError`
  signatures. Do not map arbitrary `TypeError`s, request-body read failures, or
  R2 rejections to `ObjectContentLengthMismatch`.
- Define deterministic precedence when both operations reject: a recognized
  fixed-length mismatch wins because it describes the client-input failure;
  otherwise preserve the current producer-before-consumer ordering unless the
  implementation uncovers a stronger runtime constraint.
- Preserve successful streaming, zero-byte writes, non-stream sized-body
  validation, R2 metadata mapping, and the outer `ObjectStore.put()` wrapping
  of genuine backend failures.
- Keep `ObjectContentLengthMismatch` as the adapter-facing stable code consumed
  by `storeContent()`. Document that exact-length mismatch outcome in the
  object-store interface and the Cloudflare adapter's public `put()` contract
  if the existing JSDoc does not already state it.
- Keep platform-specific simulations in the Cloudflare adapter test file, not
  the shared conformance suite. The rejection channel is a Workers runtime
  detail rather than behavior every adapter implements the same way.

**Expected touch points**

- `src/plugins/cloudflare-object-store/lib/object-store.js` — recognize
  fixed-length underflow and overflow failures from either settled operation
  and emit the stable mismatch error.
- `src/kixx/object-store/object-store-interface.js` — state the existing exact
  content-length mismatch error contract relied on by application code.
- `test/unit-tests/plugins/cloudflare-object-store/lib/object-store.test.js` —
  add Workers-specific stream and R2 doubles plus focused rejection tests.

Treat this list as orientation, not permission to ignore other necessary files.
Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] A short streamed body produces an error with code
  `ObjectContentLengthMismatch` when the native failure surfaces from the
  producer promise.
- [x] A short streamed body produces the same stable error when the native
  failure surfaces from the R2 consumer promise.
- [x] An excessive streamed body is normalized identically, including the
  consumer-side behavior observed in the Cloudflare deployment.
- [x] Every normalized error preserves the native `TypeError` as `cause`.
- [x] A non-length-related R2 rejection remains a generic
  `OperationalError`; it is not assigned `ObjectContentLengthMismatch`.
- [x] Failed exact-length writes do not publish an object in the test R2 store.
- [x] Existing successful, zero-byte, sized-body, Node adapter, transaction,
  and presentation behavior remains unchanged.
- [x] No end-to-end test files are added or modified.
- [x] The interface documentation describes the stable mismatch outcome.

**Validation**

- `node run-linter.js src/plugins/cloudflare-object-store/lib/object-store.js src/kixx/object-store/object-store-interface.js test/unit-tests/plugins/cloudflare-object-store/lib/object-store.test.js` — validates all changed JavaScript and documentation comments against project style rules.
- `node run-tests.js test/unit-tests/plugins/cloudflare-object-store/lib/object-store.test.js` — verifies Cloudflare success behavior, both fixed-length rejection channels, cause preservation, no publication, and unrelated R2 failure classification.
- `node run-tests.js test/unit-tests/plugins/node-object-store/lib/object-store.test.js test/unit-tests/app/transaction-scripts/files/replace-file.test.js` — confirms the portable adapter behavior and downstream HTTP-error translation remain intact.
- `node run-tests.js` — confirms the complete unit suite remains green.
- `git diff --check` — checks the completed patch for whitespace errors.

**Progress and handoff**

- Completed: The Cloudflare adapter recognizes exact underflow and overflow
  `TypeError` messages from either settled operation, gives a recognized
  mismatch precedence, preserves its cause, and leaves unrelated failures on
  the generic storage-error path. The portable interface and Cloudflare
  `put()` contract document the mismatch outcome. Cloudflare-specific tests
  cover both messages on both rejection channels, no publication, and
  unrelated producer and R2 failures.
- Current state: Complete.
- Remaining: Nothing.
- Decisions and discoveries: The classifier checks `error.name` and exact
  message equality so arbitrary `TypeError`s cannot become client-input
  failures. When neither result is a recognized mismatch, producer rejection
  retains precedence over consumer rejection.
- Actual files changed:
  `src/plugins/cloudflare-object-store/lib/object-store.js`;
  `src/kixx/object-store/object-store-interface.js`;
  `test/unit-tests/plugins/cloudflare-object-store/lib/object-store.test.js`;
  `agents/plans/cloudflare-fixed-length-stream-errors.md`.
- Validation run: Focused lint passed. Cloudflare adapter tests passed (8).
  Node adapter and downstream transaction-script tests passed (5). Full unit
  suite passed (1,412). `git diff --check` passed.
- Blockers: None.
