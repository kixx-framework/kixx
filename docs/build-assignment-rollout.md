Build Assignment Rollout
========================

Cutover notes for build assignment protocol 2 and content format 4. Both are
breaking changes: an old client cannot write to a new server, and a format-4
server does not read format-3 Releases.

Nothing here has been executed. Rollout needs an upgraded external publishing
CLI and an explicitly chosen target and maintenance window.

Client handoff
--------------

The external publishing CLI lives outside this repository. To work with a
protocol 2 server it must:

- Read `buildAssignmentProtocolVersion` from discovery before any write. The
  field is absent on protocol 1 servers. Supporting both generations is the
  CLI's choice; this repository serves protocol 2 only.
- Send `attributes.expectedAssignmentId` in the JSON body of every
  `PUT /builds/:buildId`: the `assignmentId` observed in Build JSON, or
  explicit `null` for a build that has never been assigned. Omitting the field
  is `428`. `If-Match` and `If-None-Match` are rejected with `400`.
- Treat the identity as an opaque string and copy it verbatim. Never derive a
  precondition from an ETag, a root hash, or a Release id.
- Use the same conditional form for publish, carry-forward, rollback, and
  restore. There is no unconditional write.
- After a `412` or a lost response, re-read the Build and reconcile before
  deciding what to do. Never retry unconditionally.

Record the CLI revision and its validation against a real target here when
rollout is authorized:

- CLI revision: _pending_
- Target validation: _pending_

Cutover checklist
-----------------

1. Pause every publisher still running the old client.
2. Keep a valid Publishing API token for the new client.
3. Snapshot the selected deployment's publishing state: the current build
   pointers, the Releases you intend to keep, and the Activation history.
4. Reset only the obsolete publishing documents in the selected document
   database, after verifying the target and the row counts, and after exporting
   the snapshot above:

   ```sql
   DELETE FROM documents WHERE type IN ('Release', 'Activation');
   ```

   Old-format Releases must not remain assignable. Accounts, publishing tokens,
   sessions, files, and every unrelated document are preserved. Never delete a
   whole database or `DATA_DIRECTORY`.
5. Deploy the new server. Format 4 is a separate namespace; older namespaces are
   untouched and are retained for recovery.
6. Republish content and assign the build with the upgraded client, using
   `expectedAssignmentId: null` for the first assignment.
7. Verify the site serves the new Release, then resume publishing.

Between steps 5 and 6 the deployment has no assignable Release, so rendering is
unavailable. Plan the window accordingly.

Rollback
--------

Rolling back after new assignments means restoring a coherent set: the old
server, its pointer namespace, and its history snapshot. Do not point two
writer versions at one namespace.

Limits
------

- Activation history is best-effort and may have permanent gaps. See
  [`publishing-api.md`](publishing-api.md). Nothing repairs a missing entry, and
  a missing entry never blocks the next publish.
- Local evidence covers the Node adapter, the Cloudflare SQL bridge, and the
  local HTTP publishing suite. No Cloudflare Workers runtime or remote target
  has been exercised.
