Test App Build Tool
===================

Add a Node.js CLI, `tools/build-test-app.js`, run from the repo root as `node tools/build-test-app.js`. It rebuilds `test-app/` from `lib/` for local runs. It first validates test-app's env files, secrets files, `.kixx/` JSON files, and config test contexts against lib's manifests and examples. Next it renders `node-config.jsonc` and `cloudflare-config.jsonc` in memory from lib's templates and test-app's own contexts. Only after every check and render passes does it wipe test-app/ (keeping its config and secrets), copy lib/ into it with the build-only files excluded, and write the hydrated configs. A `test-app/.gitignore` tracks only the hand-authored, non-secret config. Deployment tooling is out of scope.

Implementation Approach
-----------------------

### Decisions made with the operator

1. **Wipe and copy, not sync.** test-app/ is wiped before each copy, keeping only `README.md`, `.gitignore`, `.env.*` (which includes `.env.*.secrets`), `node-config-test-context.json`, `cloudflare-config-test-context.json`, and `.kixx/`. Reason: a fresh copy, so nothing stale survives after a file is deleted from lib/.
2. **Copy exclusions** (top level of lib/ only): `.kixx/`, `test/`, `.env.*` (and `.env.*.secrets`), `.gitignore`, `cloudflare-config.jsonc`, `node-config.jsonc`, `package-lock.json`, `run-linter.js`, `run-tests.js`, `eslint.config.js`, `*-test-context.json`, `*.jsonc.template`, `node_modules/`, `example.env`, `cloudflare-config.generated.js`. Reasons: copying lib's contexts would overwrite test-app's own tracked contexts. Templates are not needed because the tool writes hydrated configs instead. `node_modules/` holds dev-only test and lint deps. `example.env` is reference only. `cloudflare-config.generated.js` is deployment-tool output (gitignored in lib/); test-app's own deploy generates its own (confirmed by the operator).
3. **`example.env.secrets` is copied.** `node-server.js` reads it at boot as the secrets manifest. `docs/`, `deno.json`, `package.json` (needed for ESM in test-app), `cloudflare-server.js`, and everything else not listed above are copied too.
4. **`eslint.config.js` is excluded.** The operator's original list said `eslint-config.js`, which was confirmed as a typo.
5. **Validate first and write nothing on failure.** The tool collects every problem (missing files, and missing keys per file), prints them all to stderr, and exits 1 without touching test-app/. A failed render or JSONC parse also aborts before any write.
6. **Strictness.** Only required keys are checked. Commented `# KEY=` lines in `example.env` and `# @optional` entries in `example.env.secrets` may be absent. Extra keys are allowed everywhere. `.kixx/` checks compare literal deep leaf paths, with no wildcards.
7. **Context source.** The tool renders with test-app's own `node-config-test-context.json` and `cloudflare-config-test-context.json`, and both are required. If either is missing, the tool aborts with a hint to copy lib's `*-test-context.json` as a starting point.
8. **Git tracking.** `test-app/.gitignore` ignores everything except `README.md`, `.gitignore`, `.env.development`, `.env.production`, the two context files, and `.kixx/`. `.kixx/secrets.json` and `.env.*.secrets` are always ignored. Reason: commit config but never secrets.
9. **No automated tests or linting for `tools/`** (operator's choice). Validation is manual: run the tool against a disposable sandbox copy of the repo with valid and deliberately broken fixtures. Do not add `tools/` to any test or lint runner.

### Cross-cutting constraints

- **Out of scope:** deployment tooling. Do not modify `lib/`. If a lib change seems necessary, stop and record it as a blocker.
- **ESM:** node >= 24. `tools/package.json` sets `"type": "module"`, because the repo root has no package.json and `tools/*.js` would otherwise load as CommonJS.
- **Paths:** resolve every path from the script's location (`path.dirname(fileURLToPath(import.meta.url))`, so the repo root is its parent), never from `process.cwd()`. Manual validation depends on this: it runs a copy of the tool in `tmp/btac/`, where it must act on `tmp/btac/lib` and `tmp/btac/test-app`.
- **CLI style:** the tool takes no arguments. If any argument is given, print a one-line `USAGE` to stderr and exit 1. That way a mistyped flag such as `--dry-run` can never fall through to a wipe. Use `main().catch(...)` to set the exit code (0 on success, 1 on failure). Do not copy `lib/run-tests.js`'s `util.parseArgs`, `CommandLineError`, or `--help` machinery; with no options it has nothing to parse.
- **Code style:** follow `lib/docs/code-style-guide.md` and `lib/docs/code-documentation-guide.md`. Use blank lines between logical blocks and short comments that explain why.
- **Reuse lib modules through relative imports from `tools/`. Do not reimplement them:**
  - `../lib/kixx/vendor/templating/mod.js`
  - `../lib/kixx/config/secrets-manifest.js` (`parseSecretsManifest`)
  - `../lib/kixx/config/parse-jsonc.js` (`parseJsonc`)
- **Templating:** never mutate `templating.helpers`. Build a per-run `new Map(templating.helpers)` and add the `json` helper there.
- **Built-ins only:** `node:fs/promises` (`cp` with `filter`, `rm`, `readdir`, `readFile`, `writeFile`), `node:util`, `node:path`, `node:url`. No new dependencies.
- **Manual checks never touch real secrets or real test-app files.** Every destructive or fixture check runs in `tmp/btac/`, a disposable copy. The only checks against the real repo are the abort-path run in T1 (which writes nothing) and read-only `git` queries in T2. Never print secret values in logs, the plan, or the journal. Key names are fine.

---

### Task T1: Build tool with validation, in-memory render, wipe, and copy

**Status:** Not started
**Depends on:** None
**Documentation:** `agents/plans/config-templates.md` (template, `json` helper, and context-shape contract; its `lib/kixx/templating/` path is stale, and the module now lives at `lib/kixx/vendor/templating/`); `lib/docs/code-style-guide.md`; `lib/docs/code-documentation-guide.md`

**Objective**

`node tools/build-test-app.js` rebuilds test-app/ from lib/ exactly as described in Decisions 1 to 7. It either writes nothing and exits 1 with a complete problem list, or performs a full wipe, copy, and write and exits 0 with a one-line success message. This task owns all of the tool's behavior, so it can be verified on its own in a sandbox.

**Scope**

- In: `tools/package.json`, `tools/build-test-app.js`, and all of the tool's behavior: CLI parsing, validation, rendering, wipe, copy, write, and output.
- Out: `test-app/.gitignore` and the `test-app/README.md` update (T2). Tests and lint for tools/ (Decision 9). Any change to `lib/`.

**Design and invariants**

- **Phases run in this order, and nothing is written before phase 3:**
  1. Validate (collect all problems).
  2. Render and parse both templates.
  3. Wipe.
  4. Copy.
  5. Write the hydrated configs.

  If phase 1 finds any problem, print them all and exit 1. Skip rendering in that case, because rendering needs valid contexts. If phase 2 fails, report the failures for both templates and exit 1.
- **Validation problems** are plain strings grouped by file. A suggested stderr format is a header line followed by one indented line per problem, e.g. `test-app/.env.production: missing key TRUST_PROXY`. Paths in messages are relative to the repo root.
- **Env files** (`test-app/.env.development`, `test-app/.env.production`):
  - Required keys are `Object.keys(util.parseEnv(<lib/example.env text>))`. `util.parseEnv` skips comment lines, so commented `# KEY=` lines are optional automatically. Today this gives `ENVIRONMENT` and `TRUST_PROXY`. Do not add a separate regex for optional keys; nothing uses them.
  - Parse each test-app file with `util.parseEnv`, the same parser the runtime uses in `lib/node-environment.js` `readOptionalDotEnvFile`. A missing file is one problem; do not also list its keys as missing.
- **Secrets files** (`test-app/.env.development.secrets`, `test-app/.env.production.secrets`):
  - Required names come from `parseSecretsManifest(<lib/example.env.secrets text>).required`.
  - Parse each test-app file with `util.parseEnv` and report each required name not in `Object.keys(...)`. Do not use `compareSecretNames`; its `extra` result is ignored here, so a one-line filter is simpler.
  - Do not catch errors from `parseSecretsManifest`. `lib/example.env.secrets` is checked into the repo, so a parse failure is a programmer error. It reaches the unexpected-error path and exits 1 before anything is written.
  - Never print secret values.
- **`.kixx/` files:**
  - `test-app/.kixx/config.json` must contain every leaf path of `lib/.kixx/example.config.json`, and `test-app/.kixx/secrets.json` every leaf path of `lib/.kixx/example.secrets.json`.
  - Collect leaf paths with one small recursive walk: descend into non-null, non-array objects; anything else is a leaf. The examples hold only nested objects with string leaves, so add no special cases for arrays or empty objects.
  - A path is present when every intermediate value is a non-null object and the final key exists (`Object.hasOwn`). Its value is not checked.
  - Report missing paths dotted, e.g. `app.environments.production.origin`.
  - A missing file and invalid JSON are each one problem for that file.
- **Context files** (`test-app/node-config-test-context.json`, `test-app/cloudflare-config-test-context.json`): each must exist and parse as JSON. A missing context's problem includes the hint, e.g. `missing; copy lib/node-config-test-context.json as a starting point`. Invalid JSON is a problem.
- **Render** each template exactly as `lib/test/unit-tests/config-templates.test.js` does (`json` helper and `renderTemplate`, about lines 160 to 183):
  - The `json` helper `(_context, _options, value)` throws on `undefined`, and throws when `JSON.stringify` returns a non-string.
  - The pipeline is `tokenize(null, filename, source)`, then `buildSyntaxTree(null, tokens)`, then `createRenderFunction(null, helpers, tree)`, then `render(context, new Map())`.
  - Check each output with `parseJsonc`.
  - Report a failure as `<template filename>: <error message>`, including the cause chain's messages if they are short. The template engine wraps helper errors, so the outer message alone may only say `helper "json"`.
- **Wipe:** `readdir` test-app/ (top level) and `rm({ recursive: true, force: true })` each entry not on the keep list. Keep list:
  - `README.md`
  - `.gitignore`
  - any name starting with `.env.`
  - `node-config-test-context.json`
  - `cloudflare-config-test-context.json`
  - `.kixx`

  Never remove test-app/ itself. Do not add a target-path guard: the path is a constant derived from the script's location, and validation has already read files inside test-app/, so it exists.
- **Copy:** use `fs.cp(libDir, testAppDir, { recursive: true, filter })`. The filter excludes a source path only when its path relative to lib/ is a single top-level segment matching the Decision 2 list. Patterns:
  - `.env.*`: name starts with `.env.`
  - `*-test-context.json`: name ends with `-test-context.json`
  - `*.jsonc.template`: name ends with `.jsonc.template`
  - all other entries: exact names

  The root itself (relative path `''`) must pass the filter. Nested files with the same names, e.g. some `test/` deep in `app/`, are copied.
- **Write:** after the copy, write the rendered text verbatim to `test-app/node-config.jsonc` and `test-app/cloudflare-config.jsonc`.
- **Success output:** one short stdout line saying test-app/ was rebuilt and the two configs written. Do not count files. Exit 0.
- **Interruption:** phases 3 to 5 are not atomic. If the tool fails mid-copy, test-app/ is left partial, and rerunning repairs it. Note this in a code comment and do not build rollback. Preserved files are never written, so an interrupted run cannot damage config or secrets.
- **Idempotent:** a second run over an already-built test-app/ succeeds with identical results.
- **CLI:** any argument prints `USAGE` to stderr and exits 1 (see Cross-cutting constraints). Unexpected errors print the stack to stderr and exit 1.

**Expected touch points**

- `tools/package.json` (new): `{ "private": true, "type": "module" }`
- `tools/build-test-app.js` (new): the CLI

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `tools/package.json` exists with `"type": "module"`. `tools/build-test-app.js` runs with `node tools/build-test-app.js` from any cwd.
- [ ] With missing context files and `.kixx/` files, the tool exits 1 and lists every missing file. The context messages include the copy hint. test-app/ is byte-for-byte unchanged.
- [ ] With several simultaneous problems (a missing env key, a missing required secret, a missing `.kixx` leaf, a missing env file), all are reported in one run, exit 1, and nothing changes.
- [ ] Missing optional keys (`ADMIN_BOOTSTRAP_TOKEN`, commented env keys) and extra keys in any file do not cause failure.
- [ ] A context that makes a template render fail (missing required value) or is invalid JSON gives exit 1, and nothing changes.
- [ ] On success:
  - Stale files are gone.
  - Every preserved file is byte-identical to before the run.
  - Every Decision 2 exclusion is absent.
  - Everything else from lib/ is present with identical content.
  - Both hydrated configs parse with `parseJsonc`.
  - Exit is 0 and a success line is printed.
- [ ] A second successful run is idempotent.
- [ ] Any argument exits 1 with usage and writes nothing.
- [ ] No files in `lib/` are modified (`git status --short lib` is empty, apart from anything already dirty before the task started).

**Validation**

No automated tests or lint (Decision 9). Run these manual checks from the repo root, in order. They all use the disposable sandbox `tmp/btac/`, except the last one. Paste the observed exit codes and key output lines into the handoff notes.

1. Sandbox setup. This copies the real lib/, including its `node_modules/`, `.env.development`, `node-config.jsonc`, and the rest, so the exclusions are exercised:
   - `rm -rf tmp/btac && mkdir -p tmp/btac && cp -R tools tmp/btac/tools && cp -R lib tmp/btac/lib && cp -R test-app tmp/btac/test-app`
2. CLI check:
   - `node tmp/btac/tools/build-test-app.js --dry-run; echo "exit=$?"` should print usage and `exit=1`.
3. Abort when contexts and `.kixx/` are missing:
   - `find tmp/btac/test-app -type f | sort | xargs shasum > tmp/btac/before.txt`
   - `node tmp/btac/tools/build-test-app.js; echo "exit=$?"` should exit 1, list both context files with the copy hint, and list both `.kixx/*.json` files.
   - `find tmp/btac/test-app -type f | sort | xargs shasum > tmp/btac/after.txt && diff tmp/btac/before.txt tmp/btac/after.txt && echo UNCHANGED` should print `UNCHANGED`.
4. Build a valid fixture with stale files, and save it for resets:
   - `cp lib/node-config-test-context.json lib/cloudflare-config-test-context.json tmp/btac/test-app/ && mkdir -p tmp/btac/test-app/.kixx tmp/btac/test-app/routes && cp lib/.kixx/example.config.json tmp/btac/test-app/.kixx/config.json && cp lib/.kixx/example.secrets.json tmp/btac/test-app/.kixx/secrets.json && echo stale > tmp/btac/test-app/stale.txt && echo stale > tmp/btac/test-app/routes/deleted-in-lib.js && rm -rf tmp/btac/fixture && cp -R tmp/btac/test-app tmp/btac/fixture`
   - Reset command, used below: `rm -rf tmp/btac/test-app && cp -R tmp/btac/fixture tmp/btac/test-app`
5. Report every problem together (run the reset command first):
   - `sed -i '' '/^CSRF_TOKEN_SIGNING_SECRET=/d' tmp/btac/test-app/.env.production.secrets && sed -i '' '/^TRUST_PROXY=/d' tmp/btac/test-app/.env.development && rm tmp/btac/test-app/.env.production && node -e "const fs=require('fs');const f='tmp/btac/test-app/.kixx/config.json';const c=JSON.parse(fs.readFileSync(f,'utf8'));delete c.app.environments.production.origin;fs.writeFileSync(f,JSON.stringify(c))"`
   - Take the before snapshot (as in check 3), then run `node tmp/btac/tools/build-test-app.js; echo "exit=$?"`. It should exit 1 and report all four problems: the missing `CSRF_TOKEN_SIGNING_SECRET`, the missing `TRUST_PROXY`, the missing `.env.production` file, and the missing `app.environments.production.origin`. No secret values may appear. The after snapshot diff should print `UNCHANGED`.
6. Render failure (reset first):
   - `node -e "const fs=require('fs');const f='tmp/btac/test-app/cloudflare-config-test-context.json';const c=JSON.parse(fs.readFileSync(f,'utf8'));delete c.environments.production.WORKER.name;fs.writeFileSync(f,JSON.stringify(c))"`
   - Take a snapshot and run. It should exit 1 with a message naming `cloudflare-config.jsonc.template`, and print `UNCHANGED`.
7. Invalid context JSON (reset first):
   - `echo '{' > tmp/btac/test-app/node-config-test-context.json`
   - Take a snapshot and run. It should exit 1, report invalid JSON for that file, and print `UNCHANGED`.
8. Success, with optional keys removed and extra keys added (reset first):
   - `sed -i '' '/^ADMIN_BOOTSTRAP_TOKEN=/d' tmp/btac/test-app/.env.development.secrets tmp/btac/test-app/.env.production.secrets && echo 'EXTRA_KEY=1' >> tmp/btac/test-app/.env.development && node -e "const fs=require('fs');const f='tmp/btac/test-app/.kixx/secrets.json';const c=JSON.parse(fs.readFileSync(f,'utf8'));c.extra={nested:true};fs.writeFileSync(f,JSON.stringify(c))" && rm -rf tmp/btac/pre-run && cp -R tmp/btac/test-app tmp/btac/pre-run`
   - `node tmp/btac/tools/build-test-app.js; echo "exit=$?"` should print the success line and `exit=0`.
   - `ls tmp/btac/test-app/stale.txt tmp/btac/test-app/routes/deleted-in-lib.js` should fail for both (stale files removed).
   - `for f in .env.development .env.development.secrets .env.production .env.production.secrets README.md node-config-test-context.json cloudflare-config-test-context.json .kixx/config.json .kixx/secrets.json; do cmp tmp/btac/pre-run/$f tmp/btac/test-app/$f || echo "CHANGED $f"; done` should print nothing (preserved files untouched).
   - `ls -A tmp/btac/test-app` should show exactly these entries (as of plan writing; if lib/'s top level has changed, derive the expected list from Decision 2):
     - preserved: `.env.development`, `.env.development.secrets`, `.env.production`, `.env.production.secrets`, `.kixx`, `README.md`, `cloudflare-config-test-context.json`, `node-config-test-context.json`
     - copied: `app`, `cloudflare-server.js`, `deno.json`, `docs`, `emails`, `example.env.secrets`, `kixx`, `node-environment.js`, `node-server.js`, `package.json`, `pages`, `plugins`, `public`, `routes`, `static-assets`, `templates`, `virtual-hosts.js`
     - written: `node-config.jsonc`, `cloudflare-config.jsonc`
     - Absent: `test`, `node_modules`, `eslint.config.js`, `run-tests.js`, `run-linter.js`, `package-lock.json`, `example.env`, `*.jsonc.template`, `.gitignore` (lib's), `cloudflare-config.generated.js`.
   - `ls -A tmp/btac/test-app/.kixx` should show only `config.json` and `secrets.json` (lib's `example.*.json` files were not copied).
   - `for d in app kixx routes docs templates; do diff -r lib/$d tmp/btac/test-app/$d > /dev/null || echo "DIFF $d"; done` should print nothing (content copied faithfully).
   - `node --input-type=module -e "import fs from 'node:fs'; import assert from 'node:assert'; import { parseJsonc } from './lib/kixx/config/parse-jsonc.js'; for (const n of ['node', 'cloudflare']) { const read = (p) => parseJsonc(fs.readFileSync(p, 'utf8')); assert.deepStrictEqual(read('tmp/btac/test-app/' + n + '-config.jsonc'), read('lib/' + n + '-config.jsonc')); console.log(n, 'ok'); }"` should print `node ok` and `cloudflare ok`. The sandbox uses lib's contexts, and lib's checked-in configs are rendered from those same contexts (confirmed while planning).
9. Idempotence and cwd independence:
   - `(cd lib && node ../tmp/btac/tools/build-test-app.js; echo "exit=$?")` should exit 0, and repeating the check 8 listing and parse checks should give the same results.
10. Real repo, abort path only:
    - `ls -A test-app > tmp/btac/real-before.txt; node tools/build-test-app.js; echo "exit=$?"; ls -A test-app | diff tmp/btac/real-before.txt - && echo UNCHANGED`
    - Expected while the operator has not yet created test-app's contexts and `.kixx/` files: exit 1 with those files listed, then `UNCHANGED`.
    - If the operator has already created them and validation passes, the tool rebuilds test-app/. That is acceptable. Record which outcome happened.
11. `git status --short lib` should show no changes made by this task.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T2: test-app/.gitignore and README build instructions

**Status:** Complete
**Depends on:** None
**Documentation:** `test-app/README.md`

**Objective**

Git tracks only test-app's hand-authored, non-secret config (Decision 8), and test-app's README briefly explains how to run the build tool. This task does not need T1: `git check-ignore` evaluates paths that do not exist yet, and the README describes the behavior T1's design already fixes. Landing it first also protects the untracked secrets in test-app/ from an accidental `git add`.

**Scope**

- In: new `test-app/.gitignore` and a short addition to `test-app/README.md`.
- Out: the tool itself (T1). The root `.gitignore` (leave unchanged). Committing operator-owned config files (operator runbook).

**Design and invariants**

- **`test-app/.gitignore`**, with patterns anchored to test-app/:
  ```
  /*
  !/README.md
  !/.gitignore
  !/.env.development
  !/.env.production
  !/node-config-test-context.json
  !/cloudflare-config-test-context.json
  !/.kixx/
  /.kixx/secrets.json
  .env.*.secrets
  ```
  Add a one-line comment above each group explaining why. Secrets lines go last so no earlier negation can re-include them.
- The wipe keeps `.gitignore` and the copy skips lib's `.gitignore`, so this file survives every build.
- **README addition:** a short "Building" section (a few lines) covering:
  - The command: `node tools/build-test-app.js`, run from the repo root.
  - What it does: validates config, then replaces the copied code from lib/ and writes hydrated `node-config.jsonc` and `cloudflare-config.jsonc`.
  - What must exist first: `.env.{development,production}`, their `.secrets` files, `node-config-test-context.json`, `cloudflare-config-test-context.json`, `.kixx/config.json`, `.kixx/secrets.json`. Mention that lib's `*-test-context.json` and `lib/.kixx/example.*.json` are starting points.
  - That it writes nothing if validation fails.
  - Keep the existing text, and keep the section short.

**Expected touch points**

- `test-app/.gitignore` (new)
- `test-app/README.md`: add the Building section

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `git ls-files --others --exclude-standard test-app` lists only allowed files: `README.md`, `.gitignore`, `.env.development`, `.env.production`, and, if present, the two context files and `.kixx/` files other than `secrets.json`.
- [x] `test-app/.env.development.secrets`, `test-app/.env.production.secrets`, and `test-app/.kixx/secrets.json` are ignored. Build outputs such as `test-app/node-server.js` and `test-app/node-config.jsonc` are ignored.
- [x] The README has a short Building section matching T1's actual behavior.
- [x] The root `.gitignore` is unchanged.

**Validation**

All read-only git queries from the repo root:

- `git ls-files --others --exclude-standard test-app` should list only the allowed files above.
- `git check-ignore -v test-app/.env.development.secrets test-app/.env.production.secrets test-app/.kixx/secrets.json test-app/node-server.js test-app/node-config.jsonc test-app/app/` should report a matching `test-app/.gitignore` rule for every path. `check-ignore` evaluates patterns even when a path does not exist.
- `git check-ignore test-app/.env.development test-app/.env.production test-app/README.md test-app/.gitignore test-app/node-config-test-context.json test-app/cloudflare-config-test-context.json test-app/.kixx/config.json; echo "exit=$?"` should print no paths and `exit=1` (none ignored).
- `git diff --quiet .gitignore && echo ROOT_UNCHANGED` should print `ROOT_UNCHANGED`.
- Read `test-app/README.md` and confirm the command, prerequisites, and abort behavior match T1's **Design and invariants** (and T1's handoff notes, if T1 is done).

**Progress and handoff**

- Completed: `test-app/.gitignore` written per design; Building section appended to `test-app/README.md`.
- Current state: Complete.
- Remaining: None.
- Decisions and discoveries: `.env.development`/`.env.production` left unstaged (operator runbook commits them).
- Actual files changed: `test-app/.gitignore` (new), `test-app/README.md`.
- Validation run:
  - `git ls-files --others --exclude-standard test-app`: `.env.development`, `.env.production`, `.gitignore`, `README.md`.
  - `git check-ignore -v ...`: every path matched a `test-app/.gitignore` rule (`.env.*.secrets` line 15, `/.kixx/secrets.json` line 14, `/*` line 2 for build outputs).
  - `git check-ignore` on tracked config: no paths, `exit=1`.
  - `ROOT_UNCHANGED` printed.
  - README matches T1 design (command, prerequisites, abort-writes-nothing).
- Blockers: None.

---

Operator Runbook
----------------

Do these after T1 and T2 land. They are not agent validation steps.

- [ ] Create `test-app/node-config-test-context.json` and `test-app/cloudflare-config-test-context.json`, using lib's `*-test-context.json` as a starting point and adjusting the values for the test app (e.g. the Worker name).
- [ ] Create `test-app/.kixx/config.json` and `test-app/.kixx/secrets.json`, using `lib/.kixx/example.config.json` and `example.secrets.json` as starting points. Fill in real values, including the publishing token.
- [ ] Run `node tools/build-test-app.js` and confirm exit 0.
- [ ] Boot smoke test: `node test-app/node-server.js`, then load `http://localhost:2026/` and stop the server.
- [ ] Run `git status --short test-app` and confirm no secrets appear, then commit the tracked test-app config files.
