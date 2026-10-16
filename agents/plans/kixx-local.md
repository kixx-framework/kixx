`kixx local` — Local Target Instances
=====================================

Add a `kixx local` command family to the devkit for throwaway, writable instances of a Kixx app. `kixx local create <name>` makes `<target>/instances/<name>/` with a fresh port (`instance.json`), a `.env` and `.env.secrets` pair (fresh Build ID, random secrets named by the app's `example.env.secrets`), and nothing else. `seed` boots the app's `node-server.js` in the `local` environment, creates the root admin over the Admin API with the generated `ADMIN_BOOTSTRAP_TOKEN`, mints a Publishing API token, publishes the app's content to the instance's Build ID over the Publishing API, writes `credentials.json`, and stops the server. `start` runs the existing devserver against the instance. `publish` republishes content to a running instance. `list` and `destroy` manage instances. This replaces the old repo's `tools/local-target.js` (`~/Mark-I/projects/kixx/kixx/tools/local-target.js` and `tools/local-target/{instance,seed,serve}.js`, reference only), with one structural change: the devkit never imports or boots the app in-process. Every write goes over HTTP through existing devkit clients.

Implementation Approach
-----------------------

### Decisions made with the operator

1. **Command shape.** `kixx local <verb>`, following `devkit/commands/README.md`: `devkit/commands/local/index.js` plus one module per verb, registered in `devkit/commands/index.js`, documented in `devkit/docs/local.md`, listed in `devkit/README.md`.
2. **Verbs.** `create <name>`, `seed <name>`, `start <name>`, `publish <name>`, `list`, `destroy <name>`.
   - `seed` spawns `node-server.js` (same runtime approach as `devkit/lib/devserver/app-process.js`) on the instance port with `--environment local --dotenv <instance>/.env --port <port>`, waits until it accepts connections, creates root admin `root@<name>.local` with a random password, mints a publishing token, publishes the source content assigned to the instance's `BUILD_ID`, writes `credentials.json` (`baseUrl`, `username`, `password`, `publishingApiToken`, `buildId`, `port`), and stops the server.
   - `start` runs the existing devserver (`devkit/lib/devserver/`) against the instance's dotenv and port, in the foreground.
   - `publish` republishes source content to the running instance using `credentials.json` (origin, token, Build ID). Republishing is always manual; there is no auto-republish on content change.
   - `list` shows the instances in the target with port, seeded?, and running?.
3. **Directories.** Every verb takes the source (app) directory as the runner's optional last positional, discovered as today (nearest ancestor with `.kixx/`, default the working directory). Every verb takes `--target <dir>` (default `<source>/.kixx`). Instances live at `<target>/instances/<name>/`.
4. **No in-process boot.** The devkit is a separate package installable from JSR. It must not import the app's source. Seed works over HTTP by reusing devkit code: the accept-invite flow, publishing token minting, and the `devkit/lib/publishing/` pipeline. Refactor those commands' internals into reusable functions; never shell out to `kixx`.
5. **Credentials on disk.** Writing `credentials.json` in plain text is allowed only for local instances. `devkit/docs/admin.md` must say: never write a remote target's credentials (any remote, not only production or staging) to a file; local throwaway instances (`kixx local`) are the documented exception.
6. **No `.gitignore` writes.** The command never writes a `.gitignore`. `devkit/docs/local.md` tells users to ignore `<target>/instances/` (for example `.kixx/instances/`) themselves.
7. **Ideas kept from the old tool.** Name regex `^[a-z0-9]+(?:-[a-z0-9]+)*$`; a fresh Build ID per create, `local-<name>-<Date.now()>`; port kept in `instance.json`, not as `PORT` in `.env`, so an exported `PORT` never trips the server's no-key-defined-twice rule; random secrets; `destroy` refuses while the port accepts connections; `seed` refuses to run twice; warn on `process.env` collisions.
8. **Out of scope.** `--instance` flags on `kixx admin` or `kixx app` commands; auto-republish; any change to repo `lib/`.
9. **Runtimes.** Must work on Node.js >= 24 and Deno >= 2.8, with tests following `devkit/test/README.md`.

### Planner choices (routine; revisable with a recorded reason)

These come from the code and project conventions, not from the operator. P1 was approved by the operator on 2026-10-16; the rest are implementation-level.

- **P1. The runner learns required leading positionals (Task L1). Approved by the operator.** `devkit/commands/README.md` currently forbids `positionals`, and `devkit/test/commands/index.test.js:92` rejects them. Decision 2 requires `kixx local create <name>`, and Decision 3 keeps the app directory as the optional last positional. So a command may declare `static positionals = [ { name, description } ]`. All declared positionals are required and come before the optional directory. The runner passes their values to `run(options, positionals)` as an object keyed by name. Commands that declare none are unaffected. The alternative was `--name <name>`, which contradicts Decision 2.
- **P2. Secrets generated.** One `generateSecretToken()` value (64 hex chars) for every **required** name in `<source>/example.env.secrets` (read with `readSecretsManifest` from `devkit/lib/cloudflare/secrets-manifest.js`), plus `ADMIN_BOOTSTRAP_TOKEN` always, because seed needs it (`lib/example.env.secrets` marks it `# @optional`). Other optional names are not generated: a random value for an optional third-party key would switch on a feature with a bogus credential. Users add those to the instance's `.env.secrets` by hand (documented).
- **P3. Plain `.env` values.** Start from the active assignments in `<source>/example.env` when it exists (today: `ENVIRONMENT`, `TRUST_PROXY`), parsed with `parseEnvFile`. Drop `PORT`. Then set `ENVIRONMENT=local`, `BUILD_ID=<build id>`, and `DATA_DIRECTORY=<absolute instance directory>`. When `example.env` is missing, write just those three. This keeps app-specific plain keys without hard-coding them.
- **P4. Seed writes `credentials.json` as soon as the token is minted, before publishing.** The bootstrap token is single-use. If publishing then fails, the admin and token are not lost: the operator runs `kixx local start <name>` and `kixx local publish <name>`. "Seeded" in `list` means `credentials.json` exists.
- **P5. Seed and publish never print the password or token.** They print the base URL, username, Build ID, Release, and the `credentials.json` path, plus a one-line plain-text notice. Old-tool behavior.
- **P6. `create` takes an optional `-p, --port`.** Default: a free port from `getFreePort()` (`devkit/lib/devserver/app-process.js`). The old `createInstance` had the same option.
- **P7. `.env.secrets` and `credentials.json` are written with mode `0o600`.**
- **P8. Collision warnings** (keys in the instance's `.env`/`.env.secrets` that are also non-empty in `process.env`) print on `create`, `seed`, and `start`. They never fail the command, because the server reports the duplicate itself.
- **P9. `seed` and `start` refuse when the instance port already accepts connections**, and `publish` refuses when it does not, each with an instance-specific message.

### Facts established during planning

- `lib/node-server.js` reads `<app>/example.env.secrets` and fails at boot when a required name is missing (`lib/node-environment.js` `readEnvironment`). It merges `--dotenv`, `<dotenv>.secrets`, and `process.env`, rejecting any key defined twice. It accepts `--environment`, `--dotenv`, and `--port`.
- `lib/node-config.jsonc` `local` resolves every store path against `DATA_DIRECTORY` and uses a writable `CONTENT_STORE.rootDirectory` (`./content_store`).
- `lib/example.env.secrets` today: required `DOCUMENT_STORE_CURSOR_SIGNING_SECRET` and `CSRF_TOKEN_SIGNING_SECRET`; optional `ADMIN_BOOTSTRAP_TOKEN`. `lib/example.env` active keys: `ENVIRONMENT`, `TRUST_PROXY`.
- `lib/virtual-hosts.js` routes hostname `localhost`, so the origin must be `http://localhost:<port>`.
- The Admin API's `POST /admin-api/v1/users/invite` accepts the bootstrap token (`lib/app/transaction-scripts/admin-invites/resolve-admin-invite.js`). The email regex (`lib/app/presentation/forms/utils.js`) accepts `root@<name>.local`. Passwords must be 12–256 characters.
- A Publishing API token minted with the default `editor` role may create Releases and assign builds (`lib/app/permissions/roles.js`).
- Build pointers are read per request from SQLite (`lib/plugins/node-content-store/lib/content-store.js`), so a republish to a running instance takes effect without a restart.
- `devkit/lib/env-file.js` `parseEnvFile` rejects `BUILD_ID`, so reading an instance's `.env` needs an opt-out (Task L4).
- `devkit/test/commands/index.test.js` requires every `.js` file in a command directory to be a registered sub-command. Helper modules for `local` must live in `devkit/lib/local/`, not `devkit/commands/local/`.

### Cross-cutting constraints

- **Stand-alone package.** Nothing under `devkit/` except `devkit/test/conformance/` imports from outside `devkit/`. Never write into repo `lib/`.
- **Thin commands.** Command modules wire parsed arguments to `devkit/lib/` calls. Lifecycle, env generation, and seeding logic live in `devkit/lib/local/`.
- **Behavior preservation in refactors.** Tasks L2 and L3 change no user-visible output, flags, or exit codes of `kixx admin accept-invite`, `kixx app publish`, or `kixx dev start`. Their existing tests pass without edits, except import-path updates when a symbol moves.
- **Errors.** Operator-fixable problems throw `UsageError` (`devkit/lib/usage-error.js`). Name the instance, the path, and the next command to run where useful (for example `run "kixx local create alpha" first`).
- **Path safety.** Instance directories are only ever computed as `path.join(instancesDirectory, name)` after the name passes the regex. `destroy` removes only that directory.
- **Output.** Human text through `wrapText()` to the injected `output` stream; status lines prefixed `[kixx local] `. Never print `.env*` contents, the admin password, or the token.
- **Runtime portability.** Node.js >= 24 and Deno >= 2.8. Use `node:` built-ins only (`fs/promises`, `path`, `net` through the existing `getFreePort`/`canConnect`, `child_process` only through `AppProcess`). Child processes use `AppProcess`'s runtime detection (`deno run -A` on Deno). Import `process` from `node:process`. Do not add lint globals. Await-in-loop needs the existing eslint disable comment.
- **Injectable collaborators** only where a unit test needs a fake: `createAppProcess`, `createAdminClient`, `createPublishingClient`, `canConnect`, `getFreePort`, `now`, `createDevServer`, `signals`, output streams, and the reused lib operations. Tests that touch instance files use real temp directories (`fsp.mkdtemp(path.join(os.tmpdir(), 'kixx-local-'))`), cleaned up in `after`.
- **No real app servers in unit tests.** Seed and publish tests use fake clients and a fake app process. The real end-to-end check against repo `lib/` is in the Operator Runbook.
- **Code style.** `lib/docs/code-style-guide.md` and `lib/docs/code-documentation-guide.md`: 4-space indent, private `#` members, argument objects, `is*` checks from `devkit/lib/vendor/kixx-assert/mod.js`, JSDoc on exported contracts only, blank lines between logical blocks.
- **Validation baseline.** Every task leaves `node devkit/run-linter.js devkit` clean and `node devkit/run-tests.js` passing, run from the repo root. Tasks that add file or process behavior also run their tests with `deno run -A devkit/run-tests.js <paths>`; if `deno` is not installed, record that in the handoff instead of failing the task.

### Instance layout (shared contract for L4–L8)

```
<target>/instances/<name>/
    instance.json        { "port": <integer 1-65535> }
    .env                 plain values; ENVIRONMENT=local, BUILD_ID, DATA_DIRECTORY=<this directory>
    .env.secrets         generated secrets (mode 0600)
    credentials.json     written by seed (mode 0600):
                         { baseUrl, username, password, publishingApiToken, buildId, port }
    ...                  stores created by the running app (sqlite files, object_store/, content_store/)
```

`baseUrl` is `http://localhost:<port>/`. `instance.json` holds only the port. `BUILD_ID` and secrets live only in the dotenv pair; `credentials.json` copies `buildId` for `publish`.

---

### Task L1: Runner support for required leading positionals

**Status:** Complete
**Depends on:** None
**Documentation:** `devkit/commands/README.md` ("The Sub-command Module", "No `positionals`"); planner choice P1

**Objective**

A sub-command can declare required positional arguments that come before the optional app directory, and receives their values in `run()`. This is the runner change `kixx local <verb> <name> [directory]` needs. It is a separate, reviewable change to the CLI contract that every command shares.

**Scope**

- In: `devkit/kixx.js` parsing, usage line, and help "Arguments" section; a small pure helper for splitting positionals; `devkit/commands/README.md`; the contract test in `devkit/test/commands/index.test.js`.
- Out: any `local` command (L5+). No existing command declares positionals.

**Design and invariants**

- Declaration: `static positionals = [ { name: 'name', description: 'Instance name' } ]`. Each entry has a non-empty `name` matching `^[a-z][a-z0-9-]*$` and a non-empty `description`. Names are unique and never `directory`.
- Put the logic in a new pure module, `devkit/lib/command-positionals.js`, exporting `splitPositionals(declared, positionals)`. It returns `{ values, directory }`, where `values` is an object keyed by declared name (empty `{}` when none are declared) and `directory` is the next positional or `undefined`. It throws `UsageError` for a missing required positional (`Missing required argument <name>. Run "kixx <command> <subcommand> --help" for usage.`; the caller supplies the command label) and for extra positionals (keep today's `Unexpected argument "..."` wording).
- `kixx.js`: `resolveStartDirectory` receives only the directory remainder. Call `command.run(commandArgs.values, values)`. Commands that ignore the second argument are unaffected.
- Usage line: `<command> <subcommand> [options] <name> [directory]`, with each declared positional in `<...>` before `[directory]`. The "Arguments:" help section lists declared positionals first, then `directory`.
- `devkit/test/commands/index.test.js`: replace the `positionals === undefined` assertion with a shape check (undefined, or an array of valid entries as above).
- Rewrite the README's "No `positionals`" section to describe the new rule: required leading positionals only; options for everything optional; the runner owns the directory.

**Expected touch points**

- `devkit/lib/command-positionals.js` — new helper.
- `devkit/kixx.js` — use the helper, usage text, help rendering, pass values to `run()`.
- `devkit/commands/README.md` — contract docs.
- `devkit/test/lib/command-positionals.test.js` — new unit tests.
- `devkit/test/commands/index.test.js` — contract check.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `splitPositionals([], [])` returns `{ values: {}, directory: undefined }`; `splitPositionals([], ['../app'])` returns the directory; two positionals with none declared throw `UsageError` with the current "Unexpected argument" message.
- [x] With one declared positional: `['alpha']` gives `{ values: { name: 'alpha' }, directory: undefined }`; `['alpha', '../app']` adds the directory; `[]` throws a `UsageError` naming `<name>`; three values throw "Unexpected argument".
- [x] Every existing command's help and behavior is unchanged (`devkit/test/kixx.test.js` passes unedited).
- [x] The contract test accepts a well-formed `positionals` array and rejects a malformed one (unit-test the validator, or keep it inline in the test and cover it with a local case).
- [x] README documents the rule.

**Validation**

- `node devkit/run-tests.js devkit/test/lib/command-positionals.test.js devkit/test/commands devkit/test/kixx.test.js` — helper, contract, and unchanged entry point.
- `node devkit/run-linter.js devkit/kixx.js devkit/lib/command-positionals.js devkit/test/lib/command-positionals.test.js devkit/test/commands/index.test.js`
- `node devkit/run-tests.js` — full suite.
- End-to-end help for a declared positional is verified in L5, once a command declares one.

**Progress and handoff**

- Completed: All of L1.
- Current state: Complete.
- Remaining: None. Help for a declared positional is checked end to end in L5.
- Decisions and discoveries: The validator lives in the helper as `findPositionalsProblem(declared)` (returns a problem string or `null`); the contract test calls it and its unit tests cover well-formed and malformed declarations. `splitPositionals` takes a third argument `{ commandLabel }` for the help hint. With none declared, the extra-argument message is byte-identical to before; with some declared it reads `Unexpected argument "x". Expected <name> and an optional directory.`
- Actual files changed: `devkit/lib/command-positionals.js` (new), `devkit/kixx.js`, `devkit/commands/README.md`, `devkit/test/lib/command-positionals.test.js` (new), `devkit/test/commands/index.test.js`.
- Validation run: L1 subset on Node.js 95 tests passed; same files on Deno 36 tests passed; linter clean on the listed files; full Node.js suite 640 tests passed. `devkit/test/kixx.test.js` unedited.
- Blockers: None.

---

### Task L2: Extract reusable accept-invite and publish-and-assign operations

**Status:** Complete
**Depends on:** None
**Documentation:** `devkit/docs/admin.md`, `devkit/docs/app.md`; Decision 4

**Objective**

Seed and `kixx local publish` can redeem an invite and publish-then-assign content through library functions that the existing `kixx admin accept-invite` and `kixx app publish` commands also use. No user-visible change to either existing command.

**Scope**

- In: move invite redemption (password-length rule plus error mapping) out of `devkit/commands/admin/accept-invite.js`; move scan, `publishContent`, `assignRelease`, `ReleaseAssignmentError`, and `renderPublishResult` orchestration out of `devkit/commands/app/publish.js`.
- Out: `create-publishing-token` needs no extraction. Seed calls `AdminAPIClient#createPublishingApiToken` directly; record this in the handoff. No new commands.

**Design and invariants**

- `devkit/lib/admin/accept-invite.js`, default export `acceptInvite({ client, inviteToken, emailAddress, password })`. It checks the password length (12–256, constants move here) by throwing `UsageError` with today's exact message, calls `client.acceptInvite(inviteToken, { emailAddress, password })`, and maps `InvalidInviteError`, `NewUserConflictError`, and `InviteSpentInEmailRaceError` to today's `UsageError` messages. It returns the account. The command keeps its prompt order: it prompts first, then calls `acceptInvite` (the length check still runs before any request).
- `devkit/lib/publishing/publish-release.js`, default export `publishRelease({ client, projectDirectory, buildId, dryRun = false, fileSystem, scan, publishContent, assignRelease, formatRecovery })`. It returns `{ ...publishResult, buildId, assignmentId }` (`assignmentId` is `undefined` on a dry run). It scans `projectDirectory`, publishes with provenance `{ client: 'kixx-devkit', intendedForBuildId: buildId }`, and assigns with reason `publish` unless it is a dry run. `UnsupportedServerError` from the assignment is rethrown as-is. Any other assignment failure becomes `ReleaseAssignmentError` (moved here, same fields). Its message is today's first line plus, when `formatRecovery` is given, `\n` + `formatRecovery({ releaseId, buildId })`.
- `kixx app publish` passes a `formatRecovery` that returns exactly `Recover with: kixx app assign-build -e <env> --build-id <id> --release-id <id>`, so its message is byte-identical. Keep `resolveBuildId` in the command (its only caller).
- `devkit/lib/publishing/render-publish-result.js`: move `renderPublishResult` unchanged (named export). The command imports it.
- Injected collaborators the command accepts today (`scan`, `publishContent`, `assignRelease`, `fileSystem`, `createClient`) keep working by being passed through.

**Expected touch points**

- `devkit/lib/admin/accept-invite.js` — new.
- `devkit/lib/publishing/publish-release.js`, `devkit/lib/publishing/render-publish-result.js` — new.
- `devkit/commands/admin/accept-invite.js`, `devkit/commands/app/publish.js` — delegate.
- `devkit/test/lib/admin/accept-invite.test.js`, `devkit/test/lib/publishing/publish-release.test.js` — new.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `devkit/test/commands/admin/accept-invite.test.js` and `devkit/test/commands/app/publish.test.js` pass unedited.
- [x] `acceptInvite` unit tests: a short or long password throws before the client is called; each typed error maps to its message; other errors propagate; success returns the account.
- [x] `publishRelease` unit tests: a dry run never calls `assignRelease`; success returns `assignmentId`; `UnsupportedServerError` propagates unwrapped; another assignment failure throws `ReleaseAssignmentError` with `releaseId`, `buildId`, `cause`, and the recovery line when `formatRecovery` is supplied (and no recovery line without it); provenance carries `intendedForBuildId`.
- [x] No behavior change in either command.

**Validation**

- `node devkit/run-tests.js devkit/test/lib/admin devkit/test/lib/publishing devkit/test/commands/admin devkit/test/commands/app`
- `node devkit/run-linter.js devkit/lib/admin devkit/lib/publishing devkit/commands/admin devkit/commands/app devkit/test/lib/admin devkit/test/lib/publishing`
- `node devkit/run-tests.js` — full suite.

**Progress and handoff**

- Completed: All of L2.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries: `create-publishing-token` needs no extraction; seed (L6) calls `AdminAPIClient#createPublishingApiToken` directly. `acceptInvite` also exports `MIN_PASSWORD_LENGTH`/`MAX_PASSWORD_LENGTH`. `ReleaseAssignmentError` now lives in `devkit/lib/publishing/publish-release.js` (named export); nothing else imported it from the command, so there is no re-export. `kixx admin accept-invite` now builds the client (`target.connect()`, which only constructs it) before the password check; no request is sent before the check. `devkit/docs/architecture.md` subsystem row for `lib/admin/` mentions invite redemption.
- Actual files changed: `devkit/lib/admin/accept-invite.js` (new), `devkit/lib/publishing/publish-release.js` (new), `devkit/lib/publishing/render-publish-result.js` (new), `devkit/commands/admin/accept-invite.js`, `devkit/commands/app/publish.js`, `devkit/test/lib/admin/accept-invite.test.js` (new), `devkit/test/lib/publishing/publish-release.test.js` (new), `devkit/docs/architecture.md`.
- Validation run: L2 subset 193 tests passed on Node.js; linter clean on listed paths; full Node.js suite 649 tests passed. Same L2 subset on Deno: 193 tests passed. Existing command tests unedited.
- Blockers: None.

---

### Task L3: Extract a reusable devserver runner

**Status:** Complete
**Depends on:** None
**Documentation:** `devkit/docs/dev.md`; `agents/plans/devserver.md` (completed; historical)

**Objective**

`kixx local start` can run the same devserver, signal handling, and shutdown that `kixx dev start` uses, through one library function. `kixx dev start` behavior is unchanged.

**Scope**

- In: move the body of `DevStartCommand#run` after option parsing (the `node-server.js` check, realpath, creating and starting the devserver, the listening log line, the SIGINT/SIGTERM wait), plus `createDefaultDevServer`, into `devkit/lib/devserver/run-dev-server.js`.
- Out: any change to `AppProcess`, `DevServer`, or restart triggers. Port and environment parsing stay in the command.

**Design and invariants**

- `runDevServer({ projectDirectory, port, environment, dotenv, label, missingServerHint, output, stdout, stderr, signals, fileSystem, createDevServer })` resolves to the exit code (0 after a signal-driven stop). `label` sets the log prefix (`kixx dev` gives `[kixx dev] `). `missingServerHint` is the sentence after `No app server found at <path>.` (dev: `Pass a Kixx application directory, or run kixx dev start inside one.`).
- The listening line keeps its current text for `kixx dev`. `kixx local start` uses the same line with its own label.
- Keep the double-Ctrl-C absorption, listener removal, and no-lingering-handles guarantees exactly as they are.

**Expected touch points**

- `devkit/lib/devserver/run-dev-server.js` — new.
- `devkit/commands/dev/start.js` — delegate.
- `devkit/test/lib/devserver/run-dev-server.test.js` — new; covers `label` and `missingServerHint`. Existing `devkit/test/commands/dev/start.test.js` continues to cover the full flow.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `devkit/test/commands/dev/start.test.js` and `devkit/test/lib/devserver/*` pass unedited.
- [x] New tests: a custom label prefixes the log lines; a missing `node-server.js` throws `UsageError` with the given hint; SIGINT stops the fake devserver and resolves 0 with listeners removed.

**Validation**

- `node devkit/run-tests.js devkit/test/lib/devserver devkit/test/commands/dev`
- `deno run -A devkit/run-tests.js devkit/test/lib/devserver devkit/test/commands/dev`
- `node devkit/run-linter.js devkit/lib/devserver devkit/commands/dev devkit/test/lib/devserver`

**Progress and handoff**

- Completed: All of L3.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries: `runDevServer` is the default export of `devkit/lib/devserver/run-dev-server.js`; `createDefaultDevServer` moved with it (module-private). `DevStartCommand` now passes `fileSystem`/`createDevServer` through as given (undefined means the library default). The fake devserver needs only `port`, `start()`, and `stop()`.
- Actual files changed: `devkit/lib/devserver/run-dev-server.js` (new), `devkit/commands/dev/start.js`, `devkit/test/lib/devserver/run-dev-server.test.js` (new).
- Validation run: L3 subset 41 tests passed on Node.js and on Deno; linter clean on listed paths; full Node.js suite 651 tests passed. Existing tests unedited.
- Blockers: None.

---

### Task L4: Instance environment generation and on-disk instance store

**Status:** Complete
**Depends on:** None
**Documentation:** This plan's "Instance layout"; Decisions 3, 7; P2, P3, P6, P7, P8

**Objective**

A library owns everything about an instance on disk: name validation, paths, Build ID, dotenv generation from the source app's manifests, `instance.json`, credentials read/write, listing, and safe destruction. A conformance test proves the generated files boot-check against repo `lib/`'s own environment and config readers. The commands in L5–L7 become thin wiring over it.

**Scope**

- In: `formatEnvFile` and a reserved-name opt-out in `devkit/lib/env-file.js`; `devkit/lib/local/instance-env.js`; `devkit/lib/local/instance-store.js`; unit tests; a conformance test against repo `lib/`.
- Out: HTTP, child processes, and commands (L5–L7).

**Design and invariants**

- `env-file.js`:
  - `parseEnvFile(text, filepath, options)` gains `options.reservedNames` (default `[ 'BUILD_ID' ]`). Existing callers are unchanged.
  - `formatEnvFile(values)` writes `NAME=value` lines plus a trailing newline. Names must match the existing name pattern. A value made only of `[A-Za-z0-9_\-./:@+,]` is written bare. Any other value is wrapped in single quotes. A value containing `'`, CR, or LF throws `UsageError`. Single quotes are literal in both `util.parseEnv` (lib) and devkit's `unquote`; double quotes would expand `\n` in `util.parseEnv`.
- `instance-env.js`, `buildInstanceEnv({ sourceDirectory, buildId, dataDirectory, fileSystem })` returns `{ plain, secrets }` as name→value objects:
  - `plain`: P3.
  - `secrets`: P2, values from `generateSecretToken()` (`devkit/lib/crypto.js`). A missing `example.env.secrets` throws the existing `UsageError` from `readSecretsManifest`.
- `instance-store.js` (fs/promises against real paths; inject `fileSystem` only where a memory fake helps):
  - `INSTANCE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`; `assertValidInstanceName(name)` throws `UsageError`.
  - `resolveInstancesDirectory({ sourceDirectory, target })` returns `path.resolve(target ?? path.join(sourceDirectory, '.kixx'), 'instances')`. A relative `--target` resolves against the working directory, like `--dotenv`.
  - `getInstancePaths(instancesDirectory, name)` returns `{ directory, dotenv, dotenvSecrets, metadata, credentials }`.
  - `generateBuildId(name, now)` returns `` `local-${ name }-${ now.getTime() }` ``.
  - `createInstance({ sourceDirectory, instancesDirectory, name, port, now, getFreePort })`: validate the name; require `<source>/node-server.js` (a `UsageError` saying the source is not a Kixx app otherwise); refuse when the directory already exists; validate a given port (integer 1–65535); build the env before `mkdir`, so a bad manifest leaves nothing behind; write `instance.json`, `.env`, and `.env.secrets` (0600); on any failure after `mkdir`, remove the directory (best effort) and rethrow. Returns `{ name, directory, port, buildId, envNames }`.
  - `readInstance({ instancesDirectory, name })` returns `{ name, paths, port, env, secrets, isSeeded }`. It throws `UsageError` for a missing directory (`run "kixx local create <name>" first`), or for a missing, unparseable, or invalid `instance.json` (`destroy and re-create`). Dotenv files are parsed with `reservedNames: []`.
  - `readCredentials(paths)` returns the parsed object or `null` when absent, and throws `UsageError` when unreadable or invalid JSON. `writeCredentials(paths, credentials)` writes JSON with a trailing newline, mode 0600, and asserts every field (`baseUrl`, `username`, `password`, `publishingApiToken`, `buildId`, `port`) is present.
  - `listInstances({ instancesDirectory })` returns `[ { name, port, isSeeded } ]` sorted by name. A missing instances directory means `[]`. Entries that are not directories or have invalid names are skipped. An unreadable `instance.json` gives `port: null`.
  - `destroyInstance({ instancesDirectory, name, canConnect })`: validate the name; refuse when missing; when `instance.json` has a valid port that accepts connections, refuse (`stop it before running destroy`); else `fsp.rm(directory, { recursive: true, force: true })`. A missing or invalid `instance.json` does not block destroy (old-tool behavior).
  - `findProcessEnvCollisions(names, env = process.env)` returns the names with non-empty values in `env`, in the given order.
- Conformance test `devkit/test/conformance/local-instance-env.test.js`. Create an instance with `sourceDirectory` = repo `lib/` and a temp target whose path contains a space. Then, using lib's own modules (read-only), check:
  - `readOptionalDotEnvFile` from `lib/node-environment.js` parses both files to the same values devkit wrote.
  - `parseSecretsManifest` from `lib/kixx/config/secrets-manifest.js`: every required name has a non-empty value.
  - `readConfig` from `lib/kixx/config/read-config.js` (with `createResolveFilepath({ baseDirectory: lib, dataDirectory: env.DATA_DIRECTORY })` and `readSourceConfigFile(lib/node-config.jsonc)`) for `local` resolves `DOCUMENT_STORE.path`, `KEY_VALUE_STORE.path`, `JOB_QUEUE.path`, `OBJECT_STORE.path`, and `CONTENT_STORE.rootDirectory` inside the instance directory. Confirm the config shape during implementation.
  - Do not call lib's `readEnvironment`: it merges `process.env`, which would make the test depend on the shell.

**Expected touch points**

- `devkit/lib/env-file.js` — `formatEnvFile`, `reservedNames`.
- `devkit/lib/local/instance-env.js`, `devkit/lib/local/instance-store.js` — new.
- `devkit/test/lib/env-file.test.js` — new cases.
- `devkit/test/lib/local/instance-env.test.js`, `devkit/test/lib/local/instance-store.test.js` — new.
- `devkit/test/conformance/local-instance-env.test.js` — new.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Names: `alpha`, `a1-b2` accepted; `Alpha`, `a--b`, `-a`, `a/b`, `..`, and the empty string rejected with `UsageError`.
- [x] `create` writes the three files with the documented contents. `.env` has `ENVIRONMENT=local`, the generated `BUILD_ID`, an absolute `DATA_DIRECTORY` equal to the instance directory, and no `PORT`. `.env.secrets` has every required manifest name plus `ADMIN_BOOTSTRAP_TOKEN`, each a distinct 64-hex value, and no other optional names. Both secret files have mode 0600 (assert on POSIX only).
- [x] `create` refuses an existing instance, a source without `node-server.js`, or a source without `example.env.secrets`, and leaves no directory behind in the last two cases.
- [x] `formatEnvFile` round-trips through `parseEnvFile` (bare, single-quoted with spaces and `#`) and rejects `'` and newlines.
- [x] `readInstance`, `readCredentials`/`writeCredentials`, `listInstances` (sorted; skips junk; empty when missing), and `destroyInstance` (refuses while a fake `canConnect` returns true; removes otherwise; removes when `instance.json` is missing) behave as specified.
- [x] `findProcessEnvCollisions` ignores empty values.
- [x] The conformance test passes on Node.js and Deno.

**Validation**

- `node devkit/run-tests.js devkit/test/lib/env-file.test.js devkit/test/lib/local devkit/test/conformance/local-instance-env.test.js`
- `deno run -A devkit/run-tests.js devkit/test/lib/local devkit/test/conformance/local-instance-env.test.js`
- `node devkit/run-linter.js devkit/lib/env-file.js devkit/lib/local devkit/test/lib/local devkit/test/conformance/local-instance-env.test.js`
- `node devkit/run-tests.js` — full suite (existing `env-file` callers unchanged).

**Progress and handoff**

- Completed: All of L4.
- Current state: Complete.
- Remaining: None. Add a `lib/local/` row to the subsystem map in `devkit/docs/architecture.md` in L5, when the `local` command exists.
- Decisions and discoveries:
  - `createInstance` takes `port` as a number (the L5 command parses `--port`) and `now` as a function returning a `Date` (devkit convention, as in `create-worker-version.js`). It validates the port before touching disk, and calls `getFreePort()` only after the env is built.
  - `buildInstanceEnv` also drops an active `BUILD_ID` from `example.env` before setting its own, and reads `example.env` with `reservedNames: []`.
  - `writeCredentials` throws `TypeError` (a defect, not an operator error) for a missing field; field order in the file is fixed.
  - `readInstance` rejects a non-integer or out-of-range `instance.json` port the same as a missing file. `listInstances` reports `port: null` for those.
  - `kixx-assert`'s `assertEqual` does not deep-compare arrays or objects; tests compare `join()`/`JSON.stringify()` output.
  - `formatEnvFile` error for `'`/CR/LF names the variable but never prints the value.
- Actual files changed: `devkit/lib/env-file.js`, `devkit/lib/local/instance-env.js` (new), `devkit/lib/local/instance-store.js` (new), `devkit/test/lib/env-file.test.js`, `devkit/test/lib/local/instance-env.test.js` (new), `devkit/test/lib/local/instance-store.test.js` (new), `devkit/test/conformance/local-instance-env.test.js` (new).
- Validation run: Node.js L4 subset 45 tests passed; Deno `devkit/test/lib/local` + conformance 30 tests passed; linter clean on listed paths; full Node.js suite 685 tests passed.
- Blockers: None.

---

### Task L5: `kixx local` family with `create`, `list`, and `destroy`

**Status:** Complete
**Depends on:** L1, L4
**Documentation:** `devkit/commands/README.md`; Decisions 1–3, 7; P6, P8

**Objective**

The `local` family exists and its three filesystem-only verbs work end to end from the CLI. Grouping them proves the registration, the positional `<name>`, and `--target` before the HTTP verbs land.

**Scope**

- In: `devkit/commands/local/index.js` (description `Throwaway local instances of the app`, sub-command order `create, seed, start, publish, list, destroy`; only the three verbs from this task are registered here, and L6/L7 add theirs in place); `create.js`, `list.js`, `destroy.js`; registration in `devkit/commands/index.js`; entry-point tests.
- Out: `seed`, `start`, `publish`; docs (L8).

**Design and invariants**

- Every verb has `--target <dir>` (short `-t`, description `Directory holding instances/; default <app>/.kixx`). `create` and `destroy` declare `static positionals = [ { name: 'name', description: 'Instance name: lowercase letters, digits, single hyphens' } ]`. `list` declares none.
- Constructor: `{ projectDirectory, output, now, getFreePort, canConnect, env }` with defaults. `projectDirectory` is the source.
- `create` output: `Created local instance "<name>"`, then port, Build ID, directory, and `Next: kixx local seed <name>` (append `--target <dir>` to the hint when it was passed). On collisions: a warning line naming the keys and saying the server will refuse to start until they are unset.
- `list` output: `No local instances in <instancesDirectory>` when empty. Otherwise aligned columns `NAME  PORT  SEEDED  RUNNING` with `yes`/`no` (running = `canConnect(port)`; `-` for a null port).
- `destroy` output: `Destroyed local instance "<name>"`.
- Exit code 0 on success; refusals are `UsageError`.

**Expected touch points**

- `devkit/commands/local/{index,create,list,destroy}.js` — new.
- `devkit/commands/index.js` — register `local`.
- `devkit/test/commands/local/{create,list,destroy}.test.js` — new; temp directories and fakes.
- `devkit/test/kixx.test.js` — `local` in top-level help; `local create --help` shows `Usage: kixx local create [options] <name> [directory]` and lists `name` under Arguments; `local create` with no name exits 1 naming `<name>`.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `node devkit/kixx.js local --help` lists `create`, `list`, `destroy` in that relative order.
- [x] `create` against a temp source fixture (with `node-server.js` and `example.env.secrets`) and a temp `--target` creates the instance; a second `create` fails with `UsageError`; an invalid name fails before touching disk.
- [x] Collision warning appears when the injected env has `ENVIRONMENT` set.
- [x] `list` shows seeded/running correctly with fake `canConnect` and a hand-written `credentials.json`.
- [x] `destroy` refuses while running and removes otherwise.
- [x] `devkit/test/commands/index.test.js` passes (registration, basenames, positional shape).

**Validation**

- `node devkit/run-tests.js devkit/test/commands devkit/test/kixx.test.js`
- `deno run -A devkit/run-tests.js devkit/test/commands/local devkit/test/kixx.test.js`
- `node devkit/run-linter.js devkit/commands devkit/test/commands devkit/test/kixx.test.js`
- Manual: `node devkit/kixx.js local create --help`; `node devkit/kixx.js local create demo lib --target tmp/local-check`, then `node devkit/kixx.js local list lib --target tmp/local-check` and `node devkit/kixx.js local destroy demo lib --target tmp/local-check`. This writes only under `tmp/`.

**Progress and handoff**

- Completed: All of L5.
- Current state: Complete.
- Remaining: None. L6/L7 register `seed`, `start`, `publish` in `devkit/commands/local/index.js` so the order becomes `create, seed, start, publish, list, destroy`, and extend the `kixx.test.js` order assertion.
- Decisions and discoveries:
  - Shared command pieces live in `devkit/lib/local/command-support.js`: `TARGET_OPTION`, `NAME_POSITIONAL`, `createLocalLog(output)` (wrapped `[kixx local] ` lines), `formatLocalCommand({ command, projectDirectory, target })`, and `formatCollisionWarning(names, env)` (returns `null` when nothing collides). L6/L7 should reuse them.
  - Small deviation, recorded: the `Next:` hint also includes the app directory, relative to the working directory, when it is not the working directory (for example `kixx local seed demo lib --target tmp/local-check`). Without it the hint fails when run from where `create` was run. `--target` is appended as given.
  - `create` passes `now`/`getFreePort` through; it parses `--port` as digits and leaves the range check to `createInstance`. Its constructor does not take `canConnect` (unused).
  - `list` output is an unwrapped table: `NAME  PORT  SEEDED  RUNNING`, with `-` for a null port.
  - `devkit/docs/architecture.md`: `lib/local/` row added; `lib/devserver/` now also used by `local`.
- Actual files changed: `devkit/commands/local/{index,create,list,destroy}.js` (new), `devkit/commands/index.js`, `devkit/lib/local/command-support.js` (new), `devkit/test/commands/local/{create,list,destroy}.test.js` (new), `devkit/test/kixx.test.js`, `devkit/docs/architecture.md`.
- Validation run: `node devkit/run-tests.js devkit/test/commands devkit/test/kixx.test.js` 98 passed; Deno `devkit/test/commands/local devkit/test/kixx.test.js` 35 passed; linter clean on `devkit/commands devkit/test/commands devkit/test/kixx.test.js devkit/lib/local`; full Node.js suite 698 passed. Manual: `local create --help` shows `Usage: kixx local create [options] <name> [directory]` and lists `name`; `local create demo lib --target tmp/local-check` created the instance (`.env.secrets` mode 0600, no `PORT`); a second create failed; `local list` showed `demo <port> no no`; `local destroy` removed it; `local create Bad` failed without writing. `tmp/local-check` removed afterwards.
- Blockers: None.

---

### Task L6: `kixx local seed`

**Status:** Complete
**Depends on:** L2, L4, L5
**Documentation:** Decisions 2, 4, 5, 7; P4, P5, P8, P9

**Objective**

`kixx local seed <name>` turns a freshly created instance into a usable one over HTTP only: the root admin, a publishing token, published content on the instance's Build ID, and `credentials.json`. The app server is always stopped afterwards.

**Scope**

- In: `devkit/lib/local/seed-instance.js`; `devkit/commands/local/seed.js`; registration; tests.
- Out: `start`/`publish` (L7); docs (L8).

**Design and invariants**

- `seedInstance({ sourceDirectory, instancesDirectory, name, log, stdout, stderr, createAppProcess, createAdminClient, createPublishingClient, canConnect, acceptInvite, publishRelease, generatePassword, fileSystem })` resolves to `{ credentials, credentialsPath, publishResult }`. Defaults: `new AppProcess(...)`, `new AdminAPIClient(...)`, `new PublishingAPIClient(...)`, the L2 functions, `generateSecretToken`.
- Order, all before any spawn:
  1. `readInstance`.
  2. Refuse if `credentials.json` exists (`already seeded; destroy and re-create it to seed again`).
  3. Require non-empty `BUILD_ID` in `.env` and `ADMIN_BOOTSTRAP_TOKEN` in `.env.secrets`. A missing value is a `UsageError` naming the file. The bootstrap token may already be spent from a failed seed; the server reports that as an invalid invite, mapped by `acceptInvite` and documented in L8.
  4. Refuse if `canConnect(port)` (P9).
- Server: `createAppProcess({ projectDirectory: sourceDirectory, environment: 'local', dotenv: paths.dotenv, getFreePort: async () => port, stdout, stderr, log })`, then `ensureReady()`. On `{ failure }`, throw `UsageError` with the reason and the captured output. `appProcess.stop()` runs in `finally` on every path after the spawn.
- Origin `http://localhost:<port>`. Steps:
  1. `acceptInvite({ client: createAdminClient({ origin }), inviteToken, emailAddress: 'root@<name>.local', password })`.
  2. `createAdminClient({ origin, email, password }).createPublishingApiToken({ description: 'kixx local seed' })`.
  3. `writeCredentials` (P4).
  4. `publishRelease({ client: createPublishingClient({ origin, token }), projectDirectory: sourceDirectory, buildId, formatRecovery: () => 'Recover with: kixx local start <name>, then kixx local publish <name>' })`.
  5. If step 4 fails, wrap it in a `UsageError` (keep `cause`) saying credentials were saved and how to republish.
- Command `seed.js`: positional `name`; `--target`; `--verbose` (stream app server stdout/stderr; default off, so they go to a null sink and appear only in a failure message). It prints the collision warning (P8), then the result: base URL, username, Build ID, Release, the credentials path, `credentials.json is plain text; do not commit or share it.`, and `Next: kixx local start <name>`. Never the password or token (P5).

**Expected touch points**

- `devkit/lib/local/seed-instance.js` — new.
- `devkit/commands/local/seed.js`, `devkit/commands/local/index.js` — new verb, registered after `create`.
- `devkit/test/lib/local/seed-instance.test.js`, `devkit/test/commands/local/seed.test.js` — new.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] Happy path with fakes: the app process is created with environment `local`, the instance dotenv, and the instance port; the invite uses the `.env.secrets` bootstrap token and `root@<name>.local`; the token client authenticates with that email and password; publish targets the `.env` Build ID; `credentials.json` has all six fields with `baseUrl` `http://localhost:<port>/`; `stop()` was called once.
- [x] Refusals (already seeded, missing instance, port busy, missing `BUILD_ID` or bootstrap token) never create an app process.
- [x] A failed `ensureReady` throws a `UsageError` containing the reason and output; no client is created.
- [x] An invite failure stops the server and leaves no `credentials.json`.
- [x] A publish failure stops the server, leaves `credentials.json`, and the error names `kixx local publish <name>`.
- [x] Command output contains neither the password nor the token.

**Validation**

- `node devkit/run-tests.js devkit/test/lib/local devkit/test/commands/local devkit/test/commands/index.test.js`
- `deno run -A devkit/run-tests.js devkit/test/lib/local devkit/test/commands/local`
- `node devkit/run-linter.js devkit/lib/local devkit/commands/local devkit/test/lib/local devkit/test/commands/local`
- Real-app check: Operator Runbook.

**Progress and handoff**

- Completed: All of L6.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries:
  - `seedInstance` takes a `formatCommand(command)` function so recovery hints match the command's `Next:` hints (app directory and `--target`, via `formatLocalCommand`). Default `kixx local <command>`.
  - Publish failure message: `Local instance "<name>" has an admin and credentials saved in <path>, but publishing content failed: <cause>` plus `Recover with: kixx local start <name> ..., then kixx local publish <name> ...`. A `ReleaseAssignmentError` already carries that line (via `formatRecovery`), so it is not repeated.
  - A failed start: `The app server for local instance "<name>" failed to start: <reason>`, then `App server output:` and the captured output when non-empty.
  - A spent bootstrap token is not re-worded; `acceptInvite`'s "unknown, expired, revoked, or already used" message passes through (document in L8: destroy and re-create).
  - The command reads the instance itself (before `seedInstance` re-reads it) so the collision warning prints before the server boots. New helper `listEnvNames(instance)` in `devkit/lib/local/command-support.js`; L7 `start` should reuse it.
  - Without `--verbose`, app server stdout/stderr go to a null sink; AppProcess still captures them for the failure message. AppProcess status lines (`starting app server`, `app server ready on port`, `stopping app server`) print with the `[kixx local] ` prefix.
  - Password: `generateSecretToken()` (64 hex chars). Token description `kixx local seed`.
- Actual files changed: `devkit/lib/local/seed-instance.js` (new), `devkit/lib/local/command-support.js` (`listEnvNames`), `devkit/commands/local/seed.js` (new), `devkit/commands/local/index.js`, `devkit/test/lib/local/seed-instance.test.js` (new), `devkit/test/commands/local/seed.test.js` (new), `devkit/test/kixx.test.js` (order now `create,seed,list,destroy`).
- Validation run: `node devkit/run-tests.js devkit/test/lib/local devkit/test/commands/local devkit/test/commands/index.test.js devkit/test/kixx.test.js` 80 passed; Deno `devkit/test/lib/local devkit/test/commands/local` 51 passed; linter clean on `devkit/lib/local devkit/commands/local devkit/test/lib/local devkit/test/commands/local devkit/test/kixx.test.js`; full Node.js suite 712 passed. `node devkit/kixx.js local seed --help` checked. Real-app seed left to the Operator Runbook.
- Blockers: None.

---

### Task L7: `kixx local start` and `kixx local publish`

**Status:** Complete
**Depends on:** L2, L3, L4, L5
**Documentation:** Decision 2; P5, P8, P9

**Objective**

An instance can be run in the foreground under the devserver, and its content can be republished by hand while it runs.

**Scope**

- In: `devkit/commands/local/start.js`, `devkit/commands/local/publish.js`; registration in order (`start`, `publish` after `seed`); tests.
- Out: auto-republish; docs (L8).

**Design and invariants**

- `start <name>`: `--target`. Read the instance. Print the collision warning. Refuse if `canConnect(port)` (P9: `already running on port <port>`). Then call `runDevServer({ projectDirectory: source, port, environment: 'local', dotenv: paths.dotenv, label: 'kixx local', missingServerHint: 'Pass the application directory the instance was created from.', ... })`. If not seeded, print a hint first: `not seeded; run kixx local seed <name> for an admin login and published content`. Starting an unseeded instance is allowed (useful for testing signup with the bootstrap token).
- `publish <name>`: `--target`, `--dry-run`, `--verbose` (same meaning as `kixx app publish`). Read the instance and `readCredentials`; refuse when there are none (`run kixx local seed <name> first`). Refuse when `!canConnect(port)` (`start it with kixx local start <name>`). Then `publishRelease({ client: createPublishingClient({ origin: credentials.baseUrl, token: credentials.publishingApiToken }), projectDirectory: source, buildId: credentials.buildId, dryRun, formatRecovery: () => 'Recover with: kixx local publish <name>' })`. Print `renderPublishResult({ result, environment: 'local', origin, verbose })`.
- Constructors accept `createPublishingClient`, `publishRelease`, `canConnect`, `runDevServer`, `output`, `stdout`, `stderr`, `signals`, `env`.

**Expected touch points**

- `devkit/commands/local/start.js`, `devkit/commands/local/publish.js`, `devkit/commands/local/index.js`.
- `devkit/test/commands/local/start.test.js`, `devkit/test/commands/local/publish.test.js` — new.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `start` passes the instance port, `local`, the absolute instance dotenv, and the source directory to `runDevServer`. It refuses a running or missing instance without calling it, and prints the unseeded hint when there are no credentials.
- [x] `publish` builds the client from `credentials.json` and targets its Build ID; `--dry-run` reaches `publishRelease`; it refuses unseeded and not-running instances before any client is created; output never contains the token.
- [x] `kixx local --help` lists all six verbs in order `create, seed, start, publish, list, destroy`.

**Validation**

- `node devkit/run-tests.js devkit/test/commands/local devkit/test/commands/index.test.js devkit/test/kixx.test.js`
- `deno run -A devkit/run-tests.js devkit/test/commands/local`
- `node devkit/run-linter.js devkit/commands/local devkit/test/commands/local`

**Progress and handoff**

- Completed: All of L7.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries:
  - Both verbs build their hints with `formatLocalCommand` (app directory and `--target` included). Messages: start refuses with `Local instance "<name>" is already running on port <port>.`; unseeded hint `Local instance "<name>" is not seeded; run kixx local seed <name> ... for an admin login and published content.`; publish refuses with `... is not seeded; run kixx local seed <name> ... first.` and `... is not running on port <port>; start it with kixx local start <name> ....`; recovery `Recover with: kixx local publish <name> ...`.
  - `start` order: read instance, collision warning, refuse if running, unseeded hint, `runDevServer`. The instance port is the devserver's port; the app child gets a free port behind it (same as `kixx dev start`).
  - `publish` uses `credentials.baseUrl` as the origin and probes the `instance.json` port. Its constructor takes only what it uses (`output`, `canConnect`, `createPublishingClient`, `publishRelease`, `fileSystem`); no `stdout`/`stderr`/`signals`/`env`, since it neither runs a process nor reads the shell environment.
  - `start` also passes `fileSystem`/`createDevServer` through to `runDevServer`.
- Actual files changed: `devkit/commands/local/start.js` (new), `devkit/commands/local/publish.js` (new), `devkit/commands/local/index.js`, `devkit/test/commands/local/start.test.js` (new), `devkit/test/commands/local/publish.test.js` (new), `devkit/test/kixx.test.js` (order `create,seed,start,publish,list,destroy`).
- Validation run: `node devkit/run-tests.js devkit/test/commands/local devkit/test/commands/index.test.js devkit/test/kixx.test.js` 52 passed; Deno `devkit/test/commands/local` 23 passed; linter clean on `devkit/commands/local devkit/test/commands/local devkit/test/kixx.test.js`; full Node.js suite 721 passed. `node devkit/kixx.js local --help` lists the six verbs in order.
- Blockers: None.

---

### Task L8: Documentation

**Status:** Complete
**Depends on:** L5, L6, L7
**Documentation:** Decisions 5, 6; `devkit/docs/dev.md` as the style model

**Objective**

Users can learn and safely use `kixx local`, and no devkit document contradicts it: the credentials-on-disk rule, the "only `dev start` runs project code" claims, and the command list are all current.

**Scope**

- In: new `devkit/docs/local.md`; `devkit/README.md`; `devkit/docs/admin.md`; `devkit/docs/configuration.md`; the comment in `devkit/lib/admin/prompt-admin-credentials.js`; `devkit/commands/README.md` only if L1 left a gap.
- Out: repo `lib/` docs and `lib/.gitignore` (see the Operator Runbook).

**Design and invariants**

- `local.md` covers:
  - Purpose: the `development` content store is read-only; instances exercise write paths such as the Publishing API and admin signup.
  - A quick start (`create`, `seed`, `start`, `publish`, `destroy`) and a verb table with every option.
  - The `--target` default and directory argument, and the instance layout.
  - `credentials.json` fields and the plain-text warning.
  - That the user must add `<target>/instances/` (for example `.kixx/instances/`) to `.gitignore`; the command never does.
  - Why the port lives in `instance.json` (start `node-server.js` by hand with both `--dotenv` and `--port`).
  - `process.env` collisions.
  - Secrets: required names from `example.env.secrets` plus `ADMIN_BOOTSTRAP_TOKEN`; add other optional ones by hand.
  - Republishing is manual; under `start`, code changes restart the server but content needs `kixx local publish`.
  - Seed refuses twice. A failed seed after the invite was used needs destroy and re-create; a failed publish needs only `start` + `publish`.
  - Keep a custom `--target` in a dot-directory or outside the app, so the devserver's file watcher ignores instance files.
- `admin.md` "Credentials": never write a remote target's credentials (any remote, not only production or staging) to a file or pass them as arguments. Local throwaway instances are the documented exception: `kixx local seed` writes `credentials.json`; link `local.md`. Mirror this in the `prompt-admin-credentials.js` JSDoc only if it reads as a general rule.
- `README.md`:
  - Add the six `kixx local` commands to the list and `local.md` to the docs list (absolute link, like the others).
  - Change "Only `kixx dev start` runs project code" to name `kixx local seed` and `kixx local start` as well.
  - Update the `--allow-run` bullet the same way.
- `configuration.md:99-101`: same project-code exception.

**Expected touch points**

- `devkit/docs/local.md` (new), `devkit/README.md`, `devkit/docs/admin.md`, `devkit/docs/configuration.md`, `devkit/lib/admin/prompt-admin-credentials.js`.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `local.md` documents every verb and option exactly as implemented (check against `node devkit/kixx.js local <verb> --help`).
- [x] `grep -rn "Only \`kixx dev start\`\|never executes project code\|never written to a file" devkit/README.md devkit/docs` shows no stale claim.
- [x] `admin.md` wording matches Decision 5.
- [x] `devkit/test/manifests.test.js` still passes (docs ship in both packages).

**Validation**

- `node devkit/run-tests.js devkit/test/manifests.test.js`
- `node devkit/run-linter.js devkit/lib/admin`
- `node devkit/run-tests.js` and `node devkit/run-linter.js devkit` — final full pass.

**Progress and handoff**

- Completed: All of L8.
- Current state: Complete.
- Remaining: None. The Operator Runbook below is for the operator.
- Decisions and discoveries:
  - The user docs the plan names under `devkit/docs/` (`admin.md`, `configuration.md`, `dev.md`) actually live in `usage-docs/kixx-devkit/`; `devkit/docs/` holds only developer docs. So the new page is `usage-docs/kixx-devkit/local.md` (as the repo rules require for new commands), and `admin.md`/`configuration.md` were edited there. The README link points at `usage-docs/kixx-devkit/local.md`, like the others.
  - Also updated: `devkit/docs/packaging-and-runtimes.md` (same "only `dev start` runs project code" claim), `devkit/docs/architecture.md` (`lib/admin/` and `lib/publishing/` now also used by `local`; `lib/local/` row mentions seeding), and `devkit/docs/doc-index.md` (usage docs list).
  - `devkit/lib/admin/prompt-admin-credentials.js` unchanged: its "never accepted from argv or files" describes what the prompt reads, not a general rule, and `kixx local` does not read credentials through it.
  - `devkit/commands/README.md` unchanged; L1 left no gap.
  - The stale-claim grep (also over `usage-docs/kixx-devkit`) matches only the two rewritten lines that now name `kixx local seed` and `kixx local start`.
- Actual files changed: `usage-docs/kixx-devkit/local.md` (new), `usage-docs/kixx-devkit/admin.md`, `usage-docs/kixx-devkit/configuration.md`, `devkit/README.md`, `devkit/docs/packaging-and-runtimes.md`, `devkit/docs/architecture.md`, `devkit/docs/doc-index.md`.
- Validation run: `local.md` checked against `node devkit/kixx.js local <verb> --help` for all six verbs. `node devkit/run-tests.js devkit/test/manifests.test.js` 4 passed; `node devkit/run-linter.js devkit/lib/admin` and `node devkit/run-linter.js devkit` clean; full suite 721 passed on Node.js and 721 passed on Deno (`~/.deno/bin/deno run -A devkit/run-tests.js`).
- Blockers: None.

---

Operator Runbook
----------------

Not agent validation steps. Run after L8 from the repo root.

- [ ] Decide whether to add `.kixx/instances/` to `lib/.gitignore` (the default target for `lib/` is `lib/.kixx/instances/`, which git currently would track). The command itself never writes `.gitignore` (Decision 6).
- [ ] Node.js end-to-end against the real app:
  1. `node devkit/kixx.js local create alpha lib --target tmp/local-e2e`
  2. `node devkit/kixx.js local seed alpha lib --target tmp/local-e2e` — expect a Release and `credentials.json`.
  3. `node devkit/kixx.js local start alpha lib --target tmp/local-e2e`. Then, in another shell: log in at `<baseUrl>admin` with the credentials, and `node devkit/kixx.js local publish alpha lib --target tmp/local-e2e` after editing a page.
  4. `node devkit/kixx.js local list lib --target tmp/local-e2e` shows seeded and running.
  5. Ctrl-C, then `node devkit/kixx.js local destroy alpha lib --target tmp/local-e2e`.
  - Orchestrator run, 2026-10-16 09:35 ET (Node.js, HEAD a4be212a): steps 1–5 passed except the browser login and the page edit. Seed created `root@alpha.local`, a Release, and `credentials.json` (0600). Under `start`, `GET /` returned 200, `list` showed seeded and running, `publish` assigned the Release (0 uploads, content unchanged), `destroy` refused while running and succeeded after Ctrl-C. Still for the operator: log in at `<baseUrl>admin` and republish after a real edit.
- [ ] Repeat with `deno run -RWNE --allow-sys=homedir --allow-run devkit/kixx.js local ...` to confirm the documented permission set suffices.
