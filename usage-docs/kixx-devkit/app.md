# `kixx app` — Content Releases

Commands that publish application content and assign it to a build through
the Publishing API. See [configuration.md](configuration.md) for
`--environment` (`-e`), the origin, and the publishing token these commands
share. Both commands accept `--origin` and `--token` overrides; the token is
never printed.

## Server requirement

These commands require a deployment serving content contract version 1,
addressing format 4, and build assignment protocol 2. Before any write, they
read the server's capabilities and refuse an older deployment, naming each
mismatch. Upgrade the deployment, or target one that is already upgraded.

## Token errors

An expired or revoked publishing token (`PublishingApiTokenInactive`) fails
with a usage message: mint a new one with `kixx admin create-publishing-token`
and store it in `.kixx/secrets.json`.

## `publish`

Scans application content, uploads what the server lacks, creates an
immutable Release, and assigns it to a build.

```sh
kixx app publish -e <env> [--build-id <id>] [--dry-run] [--verbose] [--origin <url>] [--token <token>]
```

| Option | Description |
| --- | --- |
| `--build-id` | Target build; defaults to discovery's `runningBuildId` |
| `--dry-run` | Check which objects the server has and print a preview; writes nothing |
| `--verbose` | List every resource, hash, size, and disposition |

If discovery reports no running build and `--build-id` is not given, the
command fails with a usage error. After `kixx cloudflare create-worker-version`
uploads a new Worker version, publish to its `BUILD_ID` with `--build-id`
before deploying it.

Steps:

1. Scan `pages/`, `templates/`, `static-assets/`, `public/`, and `emails/`,
   and validate the whole tree. Invalid content fails before any write.
2. Ask the server which content-addressed objects it already has, and upload
   only the missing ones.
3. Create the Release.
4. Assign it to the build under the precondition described in
   [`assign-build`](#assign-build).

Dry-run stops after step 2. Output includes the environment, origin, build
id, assignment identity, resource counts, uploaded resources, unmatched files,
and the Release id. Files outside the recognized layout are reported as
unmatched, not as errors.

If the server reports it is busy (`503`), the command waits (honoring
`Retry-After`, up to 30 seconds) and retries, then uploads the remaining
objects one at a time. If it still fails, nothing was assigned, and
rerunning later is safe.

If the Release is created but assignment fails, the error names the Release
and prints a ready-to-run recovery command:

```sh
kixx app assign-build -e <env> --build-id <id> --release-id <id>
```

The Release already exists, so recovery is an assignment, not a republish.

### Stylesheet bundling

Every `.css` file under `static-assets/` is published as an entry point. Local
unconditioned `@import` rules are inlined recursively in cascade order, and
each imported file is also published as its own asset. Changing an imported
file changes the entry point's hash. Stylesheets under `public/` are published
verbatim.

Imports may be root-relative or relative to the importing file. Targets must
stay inside `static-assets/`, use canonical lowercase pathnames, end in
`.css`, and have no query string or fragment.

External imports (a URL scheme or `//`) are kept as-is. Imports with media,
`supports()`, or `layer` conditions are also kept; local ones are rewritten
root-relative and validated. Every kept import must precede bundled content.

Import cycles are rejected with the import chain. The entry point keeps a
leading UTF-8 `@charset`; inlined files lose theirs; other encodings are
rejected. Relative `url()` references are rewritten root-relative, keeping
query strings and fragments. Relative bare strings in `image-set()` must use
`url()`.

Problem codes:

- `css-import-missing`
- `css-import-invalid`
- `css-import-misplaced`
- `css-import-cycle`
- `css-charset-unsupported`
- `css-url-invalid`

## `assign-build`

Assigns an existing Release to a build.

```sh
kixx app assign-build -e <env> --build-id <id> --release-id <id> [--reason publish] [--origin <url>] [--token <token>]
```

| Option | Description |
| --- | --- |
| `--build-id` | Required build id |
| `--release-id` | Required Release id |
| `--reason` | Audit reason: `publish` (default), `rollback`, `carry-forward`, or `restore` |

The command reads the build and sends the `assignmentId` it saw as the
write's precondition, copied verbatim. A build never assigned before is
written with an empty (`null`) precondition. Output reports the new
assignment identity.

### Pointer conflicts

When the build changed between the read and the write, the server refuses
(`412 BuildPointerConflict`). The command stops and reports the intended
Release, the expected identity, and the current one. It never retries: a
retry could overwrite another operator's publish. Read the build, decide, and
run the command again.

If a command dies without printing a result, the assignment may or may not
have committed. Read the build before assuming either way.
