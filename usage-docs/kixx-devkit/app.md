# `kixx app` — Content Releases

**`kixx app publish` doesn't work in this version.** The content compiler moved into Kixx core, and the CLI that loads it isn't built yet. The command stops with a message that says so.

Commands that publish application content and assign it to a build through
the Publishing API. See [configuration.md](configuration.md) for
`--environment` (`-e`), the origin, and the deploy key these commands
share. Both commands accept `--origin` and `--token` overrides; `--token`
takes the deploy key, which is never printed.

## Server requirement

These commands require a deployment serving content contract version 2,
addressing format 4, and build assignment protocol 4. Before any write, they
read the server's capabilities and refuse an older deployment, naming each
mismatch. Upgrade the deployment, or target one that is already upgraded.

## Deploy key errors

A missing or wrong deploy key fails with `401` and names the setting to
check, `app.environments.<env>.publishingToken` in `.kixx/secrets.json`. See
[the Publishing API](../kixx-app/publishing-api.md#authentication-the-deploy-key).

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

1. Scan `pages/`, `templates/`, `static-assets/`, and `public/`, and validate
   the whole tree. Invalid content fails before any write.
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

Stylesheets are bundled by the content compiler in Kixx core, not by this
command. The rules and the `css-*` problem codes are in the compiler's
reference, `kixx/content-compiler/README.md` in your project, under
"Stylesheets" and "Problem Codes". For the checks content must pass, see
[Content](../kixx-app/content.md).

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
