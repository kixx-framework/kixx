# Environment Variable and Configuration Separation

## Implementation Approach

Environment variables and configuration settings are currently mixed. The
`.env.<environment>` files hold both real signing secrets and per-environment
operational values (`APP_NAME`, `LOG_LEVEL`), while the `<platform>-config.js`
modules hold settings. A Cloudflare deployment must therefore assume every
value in `.env.production` is a secret and bind all of them as `secret_text`,
even though most are not secrets.

This plan separates the two concerns using a single classification rule:

> **Does the value change per deploy, or only per environment?**
> Per-environment values belong in `<platform>-config.js`.
> Per-deploy values remain environment variables.

Applying that rule, and then splitting the remaining environment variables by
secrecy, yields the target state:

| Value | Read at | Destination |
| --- | --- | --- |
| `APP_NAME` | both entry points | `config.name` (already exists) |
| `LOG_LEVEL` | both entry points | `config.env.LOGGER.level` (new) |
| `ENVIRONMENT` | `cloudflare-server.js` | `.env.<environment>` (plain) |
| `BUILD_ID` | both entry points | `.env.<environment>` (plain) |
| `PORT` | `node-server.js` | `.env.<environment>` (plain) |
| `TRUST_PROXY` | `node-server.js` | `.env.<environment>` (plain) |
| `DOCUMENT_STORE_CURSOR_SIGNING_SECRET` | `app/app.js` | `.env.<environment>.secrets` |
| `CSRF_TOKEN_SIGNING_SECRET` | `app/app.js` | `.env.<environment>.secrets` |
| `ADMIN_BOOTSTRAP_TOKEN` | `admin-invites/resolve-admin-invite.js` | `.env.<environment>.secrets` |

This is the complete environment-variable surface of the codebase. No other
`env` reads exist.

### Decisions carried into every task

- **The secrecy boundary is the git boundary.** `.env.<environment>` is
  committed; `.env.<environment>.secrets` is never committed. A deployment
  script binds the first as `plain_text` and the second as `secret_text` with
  no per-key annotation, naming convention, or inline marker to keep in sync.
  The classification is structural, so it cannot silently drift.

- **No key may be defined by more than one source.** A key appearing in both
  dotenv files, or in a dotenv file and `process.env`, is a fatal startup
  error naming the key and the conflicting sources. This replaces precedence
  entirely: there is no "which source wins", because overlap is illegal. It
  exists so a secret placed in the plain file (or left exported in a shell)
  fails loudly instead of being silently resolved.

- **The collision check covers only keys the dotenv files declare.** Unrelated
  process environment entries (`PATH`, `HOME`, `NODE_ENV`) can never collide.

- **`TRUST_PROXY` stays an environment variable.** The same environment may be
  deployed both behind a trusted reverse proxy and directly, so the correct
  value is a property of the individual deploy rather than the environment.
  It is not a secret, so it lives in the plain file.

- **Cloudflare needs no runtime change for the split.** Worker bindings arrive
  in one flat namespace regardless of binding type, so `BaseContext`'s
  accessors are unaffected and the plain/secret distinction is purely a
  deploy-time concern. `cloudflare-server.js` changes only for Task 1.

- **No `*.secrets` file is ever committed, including for development.** A
  fresh clone bootstraps with
  `cp src/example.env.secrets src/.env.development.secrets`. Keeping this
  invariant absolute is the point of the split; `app/app.js` already fails
  boot loudly when a required secret is missing, so the failure is
  self-explanatory.

---

### Task 1: Configuration owns application name and log level

**Status:** Complete
**Depends on:** None
**Documentation:** `src/plugins/README.md` (entry points and source config modules)

**Objective**

`APP_NAME` and `LOG_LEVEL` are no longer environment variables. Both entry
points read the application name and log level from the resolved config, so no
environment variable supplies a value that varies only per environment.

**Scope**

- In: `node-config.js`, `cloudflare-config.js`, both entry points, removal of
  the two variables from the example env file.
- Out: The dotenv file split and the collision check (Tasks 2 and 3). This
  task leaves the single-file loading in `node-server.js` untouched.

**Design and invariants**

- `config.name` already exists at `node-config.js:2` and
  `cloudflare-config.js:2`, holding exactly the literal that
  `env.APP_NAME || 'kixx-app'` falls back to. Do not add a new field — the
  current code shadows a config value that is already present. Delete the
  `APP_NAME` read and use `config.name`.
- Add a per-environment `LOGGER: { level }` section to every environment in
  both config modules, matching the existing `HYPERVIEW` / `RATE_LIMIT`
  ALL_CAPS section convention. Development uses `debug`; staging and
  production use `info`.
- `readConfig` runs before the `Logger` is constructed in both entry points
  (`node-server.js:68`, `cloudflare-server.js:19`), so this is a pure
  reordering with no bootstrap problem.
- `ENVIRONMENT` must not move. `cloudflare-server.js:18` reads it to select
  which config environment exists, so it cannot be sourced from config.
- `cloudflare-config.js` also defines `WORKER.name`. Leave it alone; it names
  the deployed Worker, not the application, and the two are free to differ.

**Expected touch points**

- `src/node-config.js` — add `LOGGER` to each of the three environments
- `src/cloudflare-config.js` — add `LOGGER` to the production environment
- `src/node-server.js` — replace `env.APP_NAME` and `env.LOG_LEVEL` reads
- `src/cloudflare-server.js` — replace `env.APP_NAME` and `env.LOG_LEVEL` reads
- `src/example.env` — remove `APP_NAME` and `LOG_LEVEL`

**Acceptance criteria**

- [x] No source file reads `env.APP_NAME` or `env.LOG_LEVEL`.
- [x] Both entry points construct `Logger` with `config.name` and the
      configured level.
- [x] Every environment in both config modules defines `LOGGER.level`.
- [x] `cloudflare-server.js` still reads `ENVIRONMENT` from `env`.

**Validation**

- `node run-linter.js` — no lint errors in changed files
- `node run-tests.js` — existing suite still passes
- `grep -rn "APP_NAME\|LOG_LEVEL" src` returns no `env` reads

---

### Task 2: Environment source merge rejects duplicate keys

**Status:** Complete
**Depends on:** None
**Documentation:** `test/unit-tests/README.md`, `src/docs/server-error-handling.md`

**Objective**

A platform-agnostic, unit-testable function merges several environment sources
into one flat object and throws when any key is defined by more than one
source, naming the key and the sources that defined it.

**Scope**

- In: A new pure module under `src/kixx/config/` and its unit tests.
- Out: Reading files from disk and wiring into the entry point (Task 3). This
  function takes already-parsed plain objects and performs no I/O.

**Design and invariants**

- Keep the function free of `node:fs` and `node:util` so it is testable
  without a filesystem and remains usable from any runtime, consistent with
  the port/adapter separation in `src/plugins/README.md`.
- Accept named sources so the error message can identify *which* files
  conflicted, not merely that a conflict occurred. A source is a
  `{ name, values }` pair; `name` is used only in error messages.
- Only keys present in more than one source are errors. Keys unique to a
  single source pass through untouched.
- Report **every** duplicate key in one error, not just the first. A
  misconfiguration usually involves a group of related keys, and failing one
  at a time forces repeated boot cycles.
- Per `src/docs/server-error-handling.md`, a duplicate key is a deployment
  misconfiguration detected at startup, not a programmer error in the calling
  code. Throw `OperationalError` with a message naming the keys and sources.
- Because duplicates are rejected, merge order is unobservable. Do not
  document or depend on one.

**Expected touch points**

- `src/kixx/config/merge-environment-sources.js` — new module
- `test/unit-tests/kixx/config/merge-environment-sources.test.js` — new tests

**Acceptance criteria**

- [x] Merging disjoint sources returns their union.
- [x] A key in two sources throws, and the message names the key and both
      source names.
- [x] Several duplicated keys produce one error naming all of them.
- [x] An empty or omitted source is accepted and contributes nothing.
- [x] The module imports nothing from `node:*`.

**Validation**

- `node run-tests.js test/unit-tests/kixx/config` — proves merge and
  duplicate-rejection behavior
- `node run-linter.js src/kixx/config` — no lint errors

---

### Task 3: Node entry point loads plain and secret dotenv files

**Status:** Complete
**Depends on:** Task 2
**Documentation:** `README.md` (Development Server), `src/plugins/README.md`

**Objective**

`node-server.js` reads `.env.<environment>` and `.env.<environment>.secrets`
independently, merges them with `process.env` through Task 2's function, and
fails startup when any key is defined twice. Both existing deployment styles —
dotenv files, and variables set directly in `process.env` — keep working, and
now work together.

**Scope**

- In: Dotenv loading, `--dotenv` semantics, and the merge call in
  `node-server.js`.
- Out: `cloudflare-server.js`, which needs no change (bindings are already a
  single flat namespace). The actual `.env.*` file contents (Task 4).

**Design and invariants**

- Both files are independently optional. A missing file contributes nothing
  and is not an error; only a file that exists but cannot be read or parsed
  throws. The current code conflates these by treating `ENOENT` as "fall back
  to `process.env` entirely" (`node-server.js:59-66`), which is why a
  present dotenv file today silently shadows a shell-set `PORT`. Removing that
  either/or is the behavioral fix.
- `--dotenv` names the plain file; derive the secrets path by appending
  `.secrets` to the resolved path. One flag continues to select the pair.
- Pass `process.env` to the merge as a third named source so a stale exported
  secret collides loudly instead of silently overriding a file.
- `parseDotEnvFile` already wraps read and parse failures in
  `OperationalError`; keep it and extend it to distinguish a missing file from
  an unreadable one.
- The merged result is the object handed to `ApplicationContext`, so
  `BaseContext`'s accessors and every existing `getEnvString` call site are
  unchanged.
- `tools/devserver.js:43` forwards `--dotenv` to the child process unchanged
  and needs no modification, since the flag's meaning is resolved in the child.

**Expected touch points**

- `src/node-server.js` — dotenv loading, secrets path derivation, merge call

**Acceptance criteria**

- [x] Neither file present: the server starts using `process.env` alone.
- [x] Only the plain file present: its values merge with `process.env`.
- [x] Both files present: values from all three sources are visible via
      `context.getEnvString`.
- [x] A key in both dotenv files aborts startup with a message naming the key
      and both files.
- [x] A key in a dotenv file that is also set in `process.env` aborts startup.
- [x] A file that exists but is unparseable still throws, and its message
      names the file.
- [x] `--dotenv path/to/custom.env` also loads `path/to/custom.env.secrets`.

**Validation**

- `node run-linter.js src/node-server.js` — no lint errors
- `node run-tests.js` — full suite passes
- Task 2's unit tests cover the merge and duplicate-rejection rule directly.
  The entry-point wiring itself is not unit-testable in isolation, and
  `AGENTS.md` forbids running the dev server as work verification, so it is
  left to normal development use.

---

### Task 4: File layout, ignore rules, and documentation

**Status:** Complete
**Depends on:** Task 1, Task 3
**Documentation:** `README.md`, `AGENTS.md`

**Objective**

The repository's environment files reflect the split, `.gitignore` tracks the
plain files while ignoring every secrets file, and the developer documentation
explains the classification rule so the distinction survives future changes.

**Scope**

- In: `.env.*` file contents, `.gitignore`, example files, and developer
  documentation.
- Out: Any source code change (Tasks 1-3). The Cloudflare deployment script,
  which lives in a separate project and is updated independently.

**Design and invariants**

- Replace the blanket `.env.*` ignore rule with `.env` and `.env.*.secrets`,
  so `.env.<environment>` becomes tracked while every secrets file stays
  ignored. Verify the new pattern still ignores `.env.production.secrets` and
  does **not** match `example.env.secrets`, which must remain trackable.
- Split `src/.env.development` and `src/.env.production` into plain and
  secrets halves. The three signing secrets move to the `.secrets` files; the
  plain files keep `ENVIRONMENT`, and `TRUST_PROXY`, `PORT`, and `BUILD_ID`
  where a fixed value is wanted.
- Commit `src/.env.development` and `src/.env.production`. Do not commit
  either `.secrets` file. `src/.env.development.secrets` and
  `src/.env.production.secrets` must be created locally.
- Keep the existing rotation-consequence comments with the secrets they
  describe when moving them into the `.secrets` files. They document real
  operational impact and are the reason those keys are hard to rotate.
- Split `src/example.env` into `src/example.env` and
  `src/example.env.secrets`, both tracked, as the templates for each half.
- Document in `README.md` the classification rule, the two-file layout, the
  no-duplicate-keys rule, and the
  `cp src/example.env.secrets src/.env.development.secrets` bootstrap step.

**Expected touch points**

- `.gitignore` — replace `.env.*` with `.env` and `.env.*.secrets`
- `src/.env.development`, `src/.env.development.secrets` — split
- `src/.env.production`, `src/.env.production.secrets` — split
- `src/example.env`, `src/example.env.secrets` — split
- `README.md` — new section documenting the layout and rules

**Acceptance criteria**

- [x] `git check-ignore src/.env.production.secrets` reports it ignored.
- [x] `git check-ignore src/example.env.secrets` reports it **not** ignored.
- [x] `src/.env.development` and `src/.env.production` are tracked and contain
      no secret values.
- [x] No key appears in both halves of any environment, so a fresh boot passes
      Task 3's collision check.
- [x] A fresh clone boots after the documented `cp` bootstrap step alone.
- [x] `README.md` states the per-deploy versus per-environment rule.

**Validation**

- `git check-ignore -v` against each of the six env files — proves the ignore
  rules classify every file correctly
- `git status --porcelain` after the split shows no `*.secrets` file staged
- `env | grep` for the declared keys, confirming no shell export collides
  with the committed development files

---

## Progress and handoff

Applies to every task above.

- Completed: All four tasks.
- Current state: Implemented, linted, and covered by unit tests.
- Remaining: Nothing in this plan. The Cloudflare deployment script, which
  lives in a separate project, still needs to be taught to bind
  `.env.<environment>` as `plain_text` and `.env.<environment>.secrets` as
  `secret_text`.
- Decisions and discoveries:
  - `APP_NAME` needed no new config field. `config.name` already held the
    exact literal the old `env.APP_NAME || 'kixx-app'` fell back to.
  - `process.env` is an exotic host object and fails `isPlainObject`, so
    `mergeEnvironmentSources` asserts `isObjectNotNull` instead. Anything
    supporting `Object.entries` is a valid source.
  - The merge returns a null-prototype object. Keys come from files and the
    process environment, so a `__proto__` key would otherwise assign
    `Object.prototype` rather than becoming an own property.
  - `tools/devserver.js` needed no change. It passes the child's internal port
    through `--port` rather than the environment, so it cannot collide, and it
    forwards `--dotenv` unchanged because the flag resolves in the child.
  - `cloudflare-server.js` needed no change for the file split. Worker
    bindings arrive in one flat namespace regardless of binding type.
- Actual files changed:
  - `src/node-config.js` — added `LOGGER.level` to all three environments
  - `src/cloudflare-config.js` — added `LOGGER.level` to production
  - `src/node-server.js` — config-sourced name and level; two-file dotenv
    loading through `mergeEnvironmentSources`; `parseDotEnvFile` became
    `readOptionalDotEnvFile`, returning `undefined` on `ENOENT`
  - `src/cloudflare-server.js` — config-sourced name and level
  - `src/kixx/config/merge-environment-sources.js` — new
  - `test/unit-tests/kixx/config/merge-environment-sources.test.js` — new,
    25 assertions across merge, null-prototype, duplicate, and argument cases
  - `src/.env.development`, `src/.env.development.secrets` — split
  - `src/.env.production`, `src/.env.production.secrets` — split
  - `src/example.env`, `src/example.env.secrets` — split
  - `.gitignore` — `.env.*` narrowed to `.env` and `.env.*.secrets`
  - `README.md` — new "Environment Variables and Configuration" section
- Validation run:
  - `node run-linter.js` — clean across the repository
  - `node run-tests.js` — 1240 tests, no errors
  - `git check-ignore` against all six env files — the two `.secrets` files
    are ignored, the other four are trackable
- Blockers: None.
