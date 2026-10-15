Test App End-to-End Tests
=========================

Move the end-to-end (e2e) suite out of `lib/` and into `test-app/`, where it runs against a built and deployed test app before a Kixx release. `lib/test/end-to-end/` moves (with `git mv`, keeping history and layout) to `test-app/test/`. Its imports of app code point at the copy the build tool places in `test-app/`, so the tests exercise the deployed code. A new e2e-only runner, `test-app/run-tests.js`, takes over the target flags and env-var handling from `lib/run-tests.js`. `lib/run-tests.js` becomes unit-tests only. `test-app/` gets a hand-authored, tracked `package.json` and `package-lock.json` for its test dependencies, and `tools/build-test-app.js` preserves the runner, tests, and dependencies across rebuilds. Docs describe the release workflow.

Implementation Approach
-----------------------

### Decisions made with the operator

1. **Move, don't copy.** `git mv lib/test/end-to-end test-app/test` keeps the existing layout (`test-app/test/010-csrf/...`, `test-app/test/test-helpers/...`, `test-app/test/README.md`) and history. `lib/test/end-to-end/` is deleted. The tracked lib copy is the source of truth because it is newer than the `tmp/btac/lib/test/end-to-end/` snapshot: it adds `001-sanity-checks/030-admin-logout.test.js` and has the updated CSRF wording. Ignore `tmp/btac/` entirely.
2. **Test the deployed code.** Imports that reach into app code (`../../../kixx/...`, `../../../app/...`) become `../../kixx/...` and `../../app/...`. They now resolve to the copy that `tools/build-test-app.js` puts in `test-app/`.
3. **A separate e2e-only runner.** `test-app/run-tests.js` keeps from `lib/run-tests.js`: the target flags `--development`, `--cloudflare`, `--nodejs`, `--base-url`, `--username`, `--password`; their env-var behavior (`E2E_TESTS_BASE_URL`, `E2E_TESTS_ROOT_USERNAME`, `E2E_TESTS_ROOT_PASSWORD`, the `E2E_TESTS_TARGET` marker); conflict, repeat, empty, and URL validation; `--skip`; strict `parseArgs`; containment of every path in `test-app/test/`; the 10 s timeout ceiling; sorted, deduplicated load order; and the chdir to its own directory. There is no `--e2e` flag, because e2e is the only mode, and strict parsing rejects it. The "only with --e2e" check goes away, and the required-env check always runs.
4. **lib is unit-tests only.** `lib/run-tests.js` loses all e2e logic. Its root is `test/unit-tests`. It keeps strict parsing, `--skip`, path containment, and sorting and deduplication. USAGE and comments no longer mention two suites.
5. **Hand-authored test-app dependencies.** `test-app/package.json` is tracked and hand-authored, with `"type": "module"`, `"private": true`, and devDependencies `kixx-test` 3.0.0 and `kixx-assert` 2.1.1 (matching `lib/package.json`), plus `parse-html-dom`. The e2e tests import `parse-html-dom`, but no package.json in the repo declares it today. `test-app/package-lock.json` is tracked too. `node_modules/` stays ignored. Reason: `test-app/run-tests.js` and the test files must resolve the same `kixx-test` instance, because `describe()` registers into a module singleton, and `node_modules/` must survive rebuilds.
6. **Build tool preserves the test harness.** `tools/build-test-app.js` adds `package.json` to `EXCLUDED_NAMES`, so lib's package.json is no longer copied. It adds `package.json`, `package-lock.json`, `node_modules`, `run-tests.js`, and `test` to `KEEP_NAMES`, so they survive the wipe. This supersedes part of Decision 3 in `agents/plans/test-app-build-tool.md`, which copied lib's `package.json` to get ESM. The hand-authored package.json still sets `"type": "module"`, so the copied app code still loads as ESM. That completed plan is not rewritten. It only gets a short note.
7. **Cloudflare target URL.** `https://kixx-test-app.kixx.workers.dev/` (as in `lib/run-tests.js`) is correct. The README's `cloudflare.kixx-testing.dev` is wrong and gets fixed.
8. **Docs.** The moved README becomes `test-app/test/README.md`. Its commands run from `test-app/` (`node run-tests.js --development`, paths `test/...`). `test-app/README.md` gets the release workflow: build, deploy, `npm install` in test-app, run e2e. Stale references to lib e2e get fixed in `lib/test/unit-tests/README.md`, `lib/docs/admin-data-api.md`, the root `README.md`, and comments in the moved files.
9. **Out of scope:** release and deploy automation, CI, changes to what the tests assert, and `devkit/`. Verified while planning: devkit's only e2e mention is `devkit/test/run-tests.test.js`, which tests that devkit's own runner rejects `--e2e`. It needs no change.

### Planner recommendations (accepted)

Accepted by the orchestrator as following from repo facts and conventions. Implement as written.

- **R1. `docs/admin-files.md` does not exist.** It was deleted on purpose in commit `5460b1cc` ("Remove the unused admin files doc"), so it does not exist after a build either. Default: drop the link in `test-app/test/README.md` and the "See docs/admin-files.md" sentence in `large-upload-checks.js`. Keep the README's own description of the large-upload checks.
- **R2. `070-admin-assignment.test.js` never existed.** `git log --all` has no file by that name. Default: remove every README reference to it: the `--development` disabled list, its own section, and the "What a run leaves behind" paragraph.
- **R3. package.json extras.** Default: add `"name": "kixx-test-app"` (it gives a stable lockfile name) and `"engines": { "node": ">=24" }` (matching lib). Pin exact versions as lib does: `parse-html-dom` `1.0.0`. That is the only published version: author Kris Walker, repo `kixxauth/html-dom`, ESM, no dependencies (checked with `npm view` while planning).
- **R4. The runner is self-contained.** `test-app/run-tests.js` defines its own small `isNonEmptyString` and does not import `./kixx/assertions/mod.js`. Usage errors then work before the first build, and the runner does not depend on lib internals.

### Cross-cutting constraints

- **No e2e runs.** Agents never run the e2e suite or any invocation of `test-app/run-tests.js` that would import real test files against a target. Runner checks use invocations that fail before any test file is imported, a `--skip` of the whole root (zero tests), or a probe test file in a sandbox that makes no network calls. Running against `--development`, `--cloudflare`, or `--nodejs` is an operator step.
- **Do not change what tests assert.** In moved files, change only import specifiers and comments that name old paths.
- **Secrets.** Never copy, print, or read real `test-app/.env.*.secrets` or `test-app/.kixx/*.json`. Sandboxes build their secrets fixtures from lib's examples (`lib/example.env.secrets`, `lib/.kixx/example.*.json`). Never run `node tools/build-test-app.js` against the real `test-app/`; that is an operator step.
- **Commands run from the repo root** (`/Users/kris/Documents/kixx`). Verified while planning: `node lib/run-tests.js` (1846 tests passing) and `node lib/run-linter.js lib` both work from the root. lib's runner resolves `kixx-test` relative to its own file.
- **Linting test-app files.** `lib/run-linter.js` loads `lib/eslint.config.js`, whose `files` entries are relative to `lib/`. Paths outside `lib/` match no entry and are skipped silently with exit 0 (verified: a deliberately broken file under `tmp/` "passes"). So never use `node lib/run-linter.js test-app/...` as evidence. Lint test-app files by copying them into a sandbox beside `lib/eslint.config.js` (whose `files` already lists `test/` and `run-tests.js`) and calling kixx-linting directly. This command is verified to report errors:
  ```
  rm -rf tmp/lint-test-app && mkdir -p tmp/lint-test-app && cp lib/eslint.config.js tmp/lint-test-app/ && printf '{ "type": "module" }\n' > tmp/lint-test-app/package.json && cp -R test-app/test tmp/lint-test-app/test && { [ ! -f test-app/run-tests.js ] || cp test-app/run-tests.js tmp/lint-test-app/; } && node --input-type=module -e "import process from 'node:process'; import fs from 'node:fs'; import path from 'node:path'; import { runLintCli } from './lib/node_modules/kixx-linting/mod.js'; const cwd = path.resolve('tmp/lint-test-app'); const argv = [ 'run-tests.js', 'test' ].map((p) => path.join(cwd, p)).filter((p) => fs.existsSync(p)); process.exitCode = await runLintCli({ argv, cwd, stdout: process.stdout, stderr: process.stderr });"; echo "lint exit=$?"
  ```
  This is referred to below as **the test-app lint command**. Expect `lint exit=0` and no messages. Reported paths point into `tmp/lint-test-app/`. Fix the matching file under `test-app/`.
- **tools/ has no automated tests or lint** (Decision 9 of `agents/plans/test-app-build-tool.md`). Validate the build tool manually in a disposable sandbox.
- **Code style:** follow `lib/docs/code-style-guide.md` and `lib/docs/code-documentation-guide.md`. Use blank lines between logical blocks and short comments that explain why. Node >= 24, ESM.
- **Commits:** one commit per task at minimum, following the CLAUDE.md commit rules. Add a journal entry in `agents/journal/YYYY-MM-DD.md` (America/New_York timestamps) and commit it with the task. Never stage `test-app/node_modules/`, `.env.*.secrets`, or `.kixx/*.json`. Run `git status --short test-app` before every commit.

---

### Task T1: Track and preserve test-app's test harness and dependencies

**Status:** Complete
**Depends on:** None
**Documentation:** `agents/plans/test-app-build-tool.md` Decisions 1–3, 8, 9

**Objective**

`test-app/` can hold a tracked, hand-authored test harness that survives rebuilds: `package.json`, `package-lock.json`, `run-tests.js`, and `test/` are tracked by git, and `node_modules/` is installed but ignored. The build tool keeps all five and no longer copies lib's `package.json` over test-app's. The dependencies, including `parse-html-dom`, are installed and confirmed to load. This is the foundation the move (T2) and the runner (T3) build on.

**Scope**

- In: `test-app/.gitignore`, `test-app/package.json` (new), `test-app/package-lock.json` (generated by `npm install`), `tools/build-test-app.js` (`KEEP_NAMES`, `EXCLUDED_NAMES`, their comments, and the header doc comment if it lists what is kept), and a short supersession note in `agents/plans/test-app-build-tool.md`.
- Out: moving tests (T2), the runner (T3), and README updates (T5).

**Design and invariants**

- `test-app/.gitignore`: add `!/package.json`, `!/package-lock.json`, `!/run-tests.js`, `!/test/` to the "track only hand-authored" block, and update its comment. Keep the secrets rules last. `node_modules` stays ignored by `/*`.
- `test-app/package.json` (4-space indent, matching lib), per Decision 5 and R3:
  ```json
  {
      "name": "kixx-test-app",
      "private": true,
      "type": "module",
      "engines": {
          "node": ">=24"
      },
      "devDependencies": {
          "kixx-assert": "2.1.1",
          "kixx-test": "3.0.0",
          "parse-html-dom": "1.0.0"
      }
  }
  ```
  The real `test-app/package.json` today is an untracked copy of lib's. Overwrite it.
- **Agents never install dependencies.** The orchestrator wrote `test-app/package.json` (above), and the operator runs `cd test-app && npm install` to create `node_modules/` and `package-lock.json`. Agents do not run `npm install`. If `test-app/node_modules/` or `package-lock.json` is missing, or `parse-html-dom` does not export `parseHTML`, stop and record a blocker. Do not guess another package. In Validation step 2, run only the `node --input-type=module ...` import check, not `npm install`.
- `tools/build-test-app.js`: add `'package.json'` to `EXCLUDED_NAMES`. Add `'package.json'`, `'package-lock.json'`, `'node_modules'`, `'run-tests.js'`, `'test'` to `KEEP_NAMES`. lib's `test`, `run-tests.js`, `package-lock.json`, and `node_modules` are already excluded from the copy, so these keeps can never be clobbered. Update the comments: KEEP is "hand-authored config, secrets, and the e2e test harness"; EXCLUDED explains that package.json is test-app's own. No other behavior changes.
- `agents/plans/test-app-build-tool.md`: add one short note under its Decisions section saying that `agents/plans/test-app-e2e-tests.md` supersedes the package.json part of Decision 3 (and the keep list in Decision 1). Do not rewrite the completed plan.

**Expected touch points**

- `test-app/.gitignore` — track the harness files.
- `test-app/package.json` — new, hand-authored.
- `test-app/package-lock.json` — new, generated.
- `tools/build-test-app.js` — keep and exclude lists.
- `agents/plans/test-app-build-tool.md` — supersession note.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [x] `git check-ignore` reports `test-app/package.json`, `package-lock.json`, `run-tests.js`, and `test/**` as not ignored, while `node_modules/**`, copied code, `.env.*.secrets`, and `.kixx/*.json` stay ignored.
- [x] `test-app/package.json` matches the design above, and `test-app/package-lock.json` exists.
- [x] `kixx-test`, `kixx-assert`, and `parse-html-dom` (exporting a `parseHTML` function) resolve from `test-app/`.
- [x] A sandbox build keeps the harness files byte-for-byte, does not copy lib's package.json, removes stale files, and leaves copied code loading as ESM.
- [x] No change under `lib/`.

**Validation**

All commands run from the repo root.

1. Ignore rules (both loops print nothing):
   - `for p in test-app/package.json test-app/package-lock.json test-app/run-tests.js test-app/test/README.md test-app/test/010-csrf/helpers.js; do git check-ignore -q --no-index "$p" && echo "IGNORED $p"; done`
   - `for p in test-app/node_modules/kixx-test/mod.js test-app/kixx/mod.js test-app/app/x.js test-app/.env.production.secrets test-app/.kixx/secrets.json test-app/.kixx/config.json; do git check-ignore -q --no-index "$p" || echo "NOT IGNORED $p"; done`
2. Dependencies: `(cd test-app && npm install) && (cd test-app && node --input-type=module -e "import { parseHTML } from 'parse-html-dom'; import { describe } from 'kixx-test'; import { assertEqual } from 'kixx-assert'; console.log(typeof parseHTML, typeof describe, typeof assertEqual)")` prints `function function function`.
3. Sandbox build. It uses fixture secrets from lib's examples, never test-app's real ones:
   - `rm -rf tmp/e2e-build && mkdir -p tmp/e2e-build/test-app/.kixx tmp/e2e-build/test-app/test/000-marker tmp/e2e-build/test-app/node_modules/marker && cp -R tools tmp/e2e-build/tools && cp -R lib tmp/e2e-build/lib && cp test-app/README.md test-app/.gitignore test-app/.env.development test-app/.env.production test-app/node-config-test-context.json test-app/cloudflare-config-test-context.json test-app/package.json test-app/package-lock.json tmp/e2e-build/test-app/ && cp lib/example.env.secrets tmp/e2e-build/test-app/.env.development.secrets && cp lib/example.env.secrets tmp/e2e-build/test-app/.env.production.secrets && cp lib/.kixx/example.config.json tmp/e2e-build/test-app/.kixx/config.json && cp lib/.kixx/example.secrets.json tmp/e2e-build/test-app/.kixx/secrets.json && echo '// marker' > tmp/e2e-build/test-app/test/000-marker/keep.test.js && echo '// marker' > tmp/e2e-build/test-app/node_modules/marker/index.js && echo '// marker' > tmp/e2e-build/test-app/run-tests.js && echo stale > tmp/e2e-build/test-app/stale.txt`
   - `node tmp/e2e-build/tools/build-test-app.js; echo "exit=$?"` prints the success line and `exit=0`.
   - `cmp test-app/package.json tmp/e2e-build/test-app/package.json && cmp test-app/package-lock.json tmp/e2e-build/test-app/package-lock.json && echo KEPT` prints `KEPT`.
   - `cat tmp/e2e-build/test-app/run-tests.js tmp/e2e-build/test-app/test/000-marker/keep.test.js tmp/e2e-build/test-app/node_modules/marker/index.js` prints `// marker` three times.
   - `ls tmp/e2e-build/test-app/stale.txt` fails (the stale file was removed).
   - `ls -A tmp/e2e-build/test-app` shows the preserved entries (`.env.*`, `.gitignore`, `.kixx`, `README.md`, both contexts, `package.json`, `package-lock.json`, `node_modules`, `run-tests.js`, `test`), the copied lib entries from the build-tool plan's list, and the two hydrated configs. It shows no `eslint.config.js`, `run-linter.js`, `example.env`, or `*.jsonc.template`.
   - ESM check: `node --input-type=module -e "await import('./tmp/e2e-build/test-app/kixx/assertions/mod.js'); console.log('esm ok')" 2>&1` prints `esm ok` with no `MODULE_TYPELESS_PACKAGE_JSON` warning.
4. `git status --short test-app` lists only `.gitignore` (modified) and `package.json` and `package-lock.json` (untracked), plus pre-existing operator changes if any. There are no secrets and no `node_modules`.
5. `git status --short lib` is empty.

**Progress and handoff**

- Completed: All of T1.
- Current state: Complete.
- Remaining: Nothing.
- Decisions and discoveries: The orchestrator wrote `test-app/package.json`, and the operator ran `npm install`; agents did not install. Also updated the build tool's header doc comment to say the harness is kept.
- Actual files changed: `test-app/.gitignore`, `test-app/package.json` (new), `test-app/package-lock.json` (new), `tools/build-test-app.js`, `agents/plans/test-app-build-tool.md`.
- Validation run: (1) both ignore loops printed nothing. (2) Import check printed `function function function` (install step skipped; operator did it). (3) Sandbox build: success line, `exit=0`; `KEPT`; `// marker` x3; `stale.txt` gone; `ls -A` shows preserved, copied, and hydrated entries with no `eslint.config.js`, `run-linter.js`, `example.env`, or templates; `esm ok` with no warning. (4) `git status --short test-app`: `M .gitignore`, `?? package-lock.json`, `?? package.json`. (5) `git status --short lib` empty.
- Blockers: None.

---

### Task T2: Move the e2e suite into test-app/test

**Status:** Not started
**Depends on:** T1
**Documentation:** None

**Objective**

The e2e suite lives only at `test-app/test/`, with history kept, and `lib/test/end-to-end/` no longer exists. Every import that reached into lib's app code now resolves to test-app's built copy. Comments in the moved code name the new paths. The moved files load cleanly against a built copy and pass lint. Test assertions are unchanged.

**Scope**

- In: `git mv lib/test/end-to-end test-app/test`; import-specifier rewrites; path comments inside moved `.js` files (the `large-upload-checks.js` header, `200-publishing-api/050-build-pointers.test.js:23`, and any others found by grep).
- Out: the content of `test-app/test/README.md` (T5; it is only moved here), the runner (T3), and lib's runner (T4).

**Design and invariants**

- Use one directory rename: `git mv lib/test/end-to-end test-app/test`. `test-app/test` must not exist beforehand (true at planning time). After the move, `git status` should show 34 renames (`R`).
- Rewrite every `'../../../kixx/` to `'../../kixx/` and every `'../../../app/` to `'../../app/` in the moved files. Known sites:
  - `010-csrf/helpers.js` (3 imports: `app/presentation/lib/csrf.js`, `app/presentation/lib/admin-session-cookie.js`, `app/lib/admin-session.js`)
  - `010-csrf/010-form-lifecycle.test.js` (`app/presentation/lib/csrf.js`)
  - `200-publishing-api/020-objects.test.js` (`kixx/content-addressable-store/addressing.js`)
  - `200-publishing-api/030-releases.test.js` (`kixx/content-addressable-store/content-addressable-store.js`)
  - `test-helpers/publishing-workflows.js` (`kixx/content-addressable-store/addressing.js`)

  Re-grep afterward. Relative imports between moved files (`../test-helpers/...`, `./helpers.js`) are unchanged.
- Comment updates (wording only):
  - `large-upload-checks.js` header: make the usage example `node test/100-admin-files/large-upload-checks.js`, run from `test-app/`. Per R1, remove the "See docs/admin-files.md ..." sentence.
  - `050-build-pointers.test.js`: change `test/end-to-end/README.md` to `test/README.md`.
- These files are not linted by `node lib/run-linter.js` once moved (see Cross-cutting constraints), so use the test-app lint command.

**Expected touch points**

- `lib/test/end-to-end/**` → `test-app/test/**` — moved.
- The five import-site files listed above, plus `test-app/test/100-admin-files/large-upload-checks.js` and `test-app/test/200-publishing-api/050-build-pointers.test.js`.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `lib/test/end-to-end` does not exist. `test-app/test/` has all 34 files in the same layout, recorded by git as renames.
- [ ] No moved file contains `../../../`. The rewritten imports resolve against a built copy.
- [ ] No moved `.js` file mentions `test/end-to-end` or `docs/admin-files.md`.
- [ ] All moved test files import without errors in a sandbox (no tests are executed).
- [ ] The test-app lint command passes.
- [ ] `git diff -M --stat` shows only the expected content edits. Assertions are untouched.

**Validation**

From the repo root:

1. `test ! -e lib/test/end-to-end && find test-app/test -type f | wc -l` prints `34`.
2. `grep -rn "\.\./\.\./\.\./" test-app/test; grep -rn "test/end-to-end\|admin-files.md" test-app/test --include='*.js'` prints nothing.
3. `git diff --cached -M --stat` (or `git show -M --stat` after the commit) lists renames, and only the files above have content changes.
4. Load check. It imports every `*.test.js` against a sandbox with lib's current `kixx/` and `app/`. Importing only registers `describe` blocks and runs no tests. The dummy target is a closed local port:
   - `rm -rf tmp/e2e-load && mkdir -p tmp/e2e-load && cp -R lib/kixx lib/app tmp/e2e-load/ && cp -R test-app/test tmp/e2e-load/test && cp test-app/package.json tmp/e2e-load/ && ln -s ../../test-app/node_modules tmp/e2e-load/node_modules`
   - `E2E_TESTS_BASE_URL=http://127.0.0.1:9/ E2E_TESTS_ROOT_USERNAME=load-check E2E_TESTS_ROOT_PASSWORD=load-check node --input-type=module -e "import fsp from 'node:fs/promises'; import path from 'node:path'; import { pathToFileURL } from 'node:url'; const root = path.resolve('tmp/e2e-load/test'); const files = (await fsp.readdir(root, { recursive: true })).filter((f) => f.endsWith('.test.js')).sort(); for (const f of files) { await import(pathToFileURL(path.join(root, f))); } console.log('loaded', files.length);"; echo "exit=$?"` prints `loaded 22` (the `*.test.js` count at planning time) and `exit=0`.
   - `node --check test-app/test/100-admin-files/large-upload-checks.js` passes. It is a standalone script, so do not import it; that would run it.
5. The test-app lint command prints `lint exit=0`.
6. `node lib/run-tests.js` still passes. The lib runner never loaded `test/end-to-end` for unit runs, so the count is unchanged.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T3: E2E-only runner at test-app/run-tests.js

**Status:** Not started
**Depends on:** T1, T2
**Documentation:** `test-app/test/README.md` (moved in T2; it describes the runner behavior to preserve)

**Objective**

`node run-tests.js` in `test-app/` (or `node test-app/run-tests.js` from anywhere) runs the e2e suite in `test-app/test/` with the same target selection, validation, timeout, and load-order guarantees as today's `lib/run-tests.js --e2e`, but with no mode flag. Because the runner and the tests both resolve `kixx-test` from `test-app/node_modules`, they share one registration singleton.

**Scope**

- In: new `test-app/run-tests.js`.
- Out: stripping lib's runner (T4) and documenting the runner (T5).

**Design and invariants**

- Start from `lib/run-tests.js` and keep its structure, `CommandLineError` handling, reporter, and helper functions. Changes:
  - `ROOT_DIRECTORY` is the runner's own directory (test-app/). `TEST_ROOT = path.join(ROOT_DIRECTORY, 'test')`. Drop `UNIT_TEST_ROOT` and the "two roots" comment.
  - Remove the `e2e` option. Strict parsing then rejects `--e2e` as an unknown option. Keep `tokens: true`; repeat detection needs it.
  - `configureEndToEndEnvironment` always validates: drop the `if (!args.values.e2e)` branch and its "only with --e2e" error. Keep the order: repeat check, base-URL conflict, empty strings, overrides (including clearing and setting `E2E_TESTS_TARGET`), the required-env check, then URL validation.
  - Always call `runTests({ timeout: END_TO_END_TIMEOUT })` with `10000`. Keep the ceiling comment.
  - Keep the target URLs exactly: development `http://localhost:2026/`, cloudflare `https://kixx-test-app.kixx.workers.dev/`, nodejs `https://nodejs.kixx-testing.dev/`.
  - Path containment applies to positionals and `--skip` against `TEST_ROOT`. Update the comments that justify containment by the `--e2e` mode flag; the reason now is to reject paths outside the suite, such as lib's unit tests. The error message may say "outside the test root".
  - Keep `process.chdir(ROOT_DIRECTORY)` after resolving paths, with the comment updated to say test-app/.
  - Per R4, define `isNonEmptyString` locally (equivalent to lib's `Boolean(value && isString(value))` in `lib/kixx/assertions/`). Do not import from `./kixx/`.
  - New USAGE: `Usage: node run-tests.js [--skip <path>] [--base-url <url> | --development | --cloudflare | --nodejs] [--username <username>] [--password <password>] [pathname ...]`.
  - Add a header doc comment: e2e-only runner for test-app; requires `npm install` in test-app/ and a built and deployed target; points to `test/README.md`.
- Node only. Keep the code-unit sort comment, which also mentions Deno.

**Expected touch points**

- `test-app/run-tests.js` — new.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `--e2e` and other unknown flags exit 1 with the parse message and USAGE on stderr.
- [ ] Conflicting base-URL flags, repeated options, empty string options, invalid or whitespace-padded URLs (from a flag or the env), and missing env vars each exit 1 with the existing messages and without importing test files.
- [ ] Positional and `--skip` paths outside `test-app/test/` exit 1. A nonexistent path inside it exits 1.
- [ ] Target flags set `E2E_TESTS_BASE_URL` and `E2E_TESTS_TARGET`. `--base-url` clears an inherited `E2E_TESTS_TARGET`. cwd during the run is `test-app/` (or the runner's own directory).
- [ ] The 10 s ceiling applies even when a `describe` block asks for more.
- [ ] Runner and test files share the `kixx-test` instance (a probe test registered by a test file runs).
- [ ] The test-app lint command passes.

**Validation**

From the repo root. `CLEAN` stands for `env -u E2E_TESTS_BASE_URL -u E2E_TESTS_ROOT_USERNAME -u E2E_TESTS_ROOT_PASSWORD -u E2E_TESTS_TARGET`. Write it out in full in each command. `CREDS` stands for `--username u --password p`. None of these imports a real test file. Record each exit code and the key stderr line.

1. Usage errors in the real test-app (each prints `exit=1`):
   - `CLEAN node test-app/run-tests.js --e2e; echo "exit=$?"` (unknown option `--e2e`)
   - `CLEAN node test-app/run-tests.js --bogus; echo "exit=$?"`
   - `CLEAN node test-app/run-tests.js --development --cloudflare CREDS; echo "exit=$?"` (only one base URL option)
   - `CLEAN node test-app/run-tests.js --development --base-url http://127.0.0.1:9/ CREDS; echo "exit=$?"`
   - `CLEAN node test-app/run-tests.js --development --username a --username b --password p; echo "exit=$?"` (cannot be repeated)
   - `CLEAN node test-app/run-tests.js --base-url '' CREDS; echo "exit=$?"` (cannot be empty)
   - `CLEAN node test-app/run-tests.js; echo "exit=$?"` (lists all three missing variables)
   - `CLEAN node test-app/run-tests.js --development; echo "exit=$?"` (lists only username and password)
   - `CLEAN node test-app/run-tests.js --base-url ftp://127.0.0.1/ CREDS; echo "exit=$?"` and `CLEAN node test-app/run-tests.js --base-url ' http://127.0.0.1:9/' CREDS; echo "exit=$?"`
   - `CLEAN E2E_TESTS_BASE_URL=not-a-url E2E_TESTS_ROOT_USERNAME=u E2E_TESTS_ROOT_PASSWORD=p node test-app/run-tests.js; echo "exit=$?"` (env-supplied URL validated)
   - `CLEAN node test-app/run-tests.js --base-url http://127.0.0.1:9/ CREDS lib/test/unit-tests; echo "exit=$?"` and `CLEAN node test-app/run-tests.js --base-url http://127.0.0.1:9/ CREDS --skip lib; echo "exit=$?"` (outside the test root)
   - `CLEAN node test-app/run-tests.js --base-url http://127.0.0.1:9/ CREDS test-app/test/does-not-exist; echo "exit=$?"`
2. Zero-test run (proves `kixx-test` resolves from test-app and the flow completes): `CLEAN node test-app/run-tests.js --base-url http://127.0.0.1:9/ CREDS --skip test-app/test; echo "exit=$?"` prints `Ran 0 tests` and `exit=0`.
3. Probe sandbox. It holds no real tests and makes no network calls:
   - `rm -rf tmp/e2e-runner && mkdir -p tmp/e2e-runner/test && cp test-app/run-tests.js test-app/package.json tmp/e2e-runner/ && ln -s ../../test-app/node_modules tmp/e2e-runner/node_modules`
   - Write `tmp/e2e-runner/test/probe.test.js`. It imports `describe` from `kixx-test`, and its single `it` writes `PROBE <E2E_TESTS_BASE_URL> <E2E_TESTS_TARGET> <process.cwd()>` to stdout.
   - `CLEAN E2E_TESTS_TARGET=stale node tmp/e2e-runner/run-tests.js --development CREDS; echo "exit=$?"` prints `PROBE http://localhost:2026/ development <abs path>/tmp/e2e-runner`, `Ran 1 tests`, and `exit=0`.
   - `CLEAN E2E_TESTS_TARGET=development node tmp/e2e-runner/run-tests.js --base-url http://127.0.0.1:9/ CREDS; echo "exit=$?"` prints `PROBE http://127.0.0.1:9/ undefined ...`.
   - `CLEAN node tmp/e2e-runner/run-tests.js --cloudflare CREDS` prints the `https://kixx-test-app.kixx.workers.dev/` base URL with target `cloudflare`.
   - Timeout ceiling: write `tmp/e2e-runner/test/timeout.test.js` with `describe('ceiling', ..., { timeout: 20000 })` and an `it` that awaits an 10500 ms `setTimeout`. Then run `CLEAN node tmp/e2e-runner/run-tests.js --development CREDS tmp/e2e-runner/test/timeout.test.js; echo "exit=$?"`. It reports a timeout failure and `exit=1`.
4. The test-app lint command prints `lint exit=0` (now including `run-tests.js`).

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T4: Make lib/run-tests.js unit-tests only

**Status:** Not started
**Depends on:** T3
**Documentation:** `lib/test/unit-tests/README.md` (updated in T5)

**Objective**

`lib/run-tests.js` runs only `lib/test/unit-tests/`. It has no e2e options, constants, env handling, or timeout override. It keeps strict parsing, `--skip`, path containment, and deterministic sorted, deduplicated loading. The dependency on T3 ensures the repo never sits between commits with no way to run e2e.

**Scope**

- In: `lib/run-tests.js`.
- Out: docs (T5), test-app (T1–T3).

**Design and invariants**

- Remove: the `e2e`, `base-url`, `username`, `password`, `development`, `cloudflare`, and `nodejs` options; `END_TO_END_*`, the `REQUIRED_END_TO_END_*` constants, and `END_TO_END_TEST_ROOT`; `configureEndToEndEnvironment` and every assert and apply helper it calls (`assertOptionsNotRepeated`, `assertBaseUrlOptionsDoNotConflict`, `assertStringOptionsAreNotEmpty`, `applyEndToEndEnvironmentOverrides`, `assertEndToEndEnvironmentIsComplete`, `assertBaseUrlIsValid`); the `isNonEmptyString` import if it becomes unused; `tokens: true`, which only repeat detection used; and the timeout branch (`runTests()` with no options).
- `TEST_ROOT = path.join(ROOT_DIRECTORY, 'test', 'unit-tests')`. Keep `assertTestRootExists`, `assertPathsInTestRoot`, `--skip`, `compareFilepaths`, `dropDuplicateFilepaths`, and the chdir to lib/.
- USAGE becomes `Usage: node run-tests.js [--skip <path>] [pathname ...]`.
- Rewrite the comments that mention two suites, the mode flag, `--e2e`/`--e2ee` typos, or end-to-end. Strict parsing still matters: a typo such as `--skp` must fail instead of being ignored. Containment now keeps paths inside the unit-test tree. Add a one-line pointer that e2e tests live in `test-app/` with their own runner.
- `CommandLineError`'s comment ("a missing target") should no longer mention targets.

**Expected touch points**

- `lib/run-tests.js` — e2e logic removed.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] `grep -n "e2e\|end-to-end\|E2E_\|base-url\|cloudflare\|nodejs\|development" lib/run-tests.js` prints nothing (except the pointer to test-app, if worded with "e2e"; keep it to one line).
- [ ] The full unit suite passes from the repo root and from `lib/`.
- [ ] `--e2e`, `--development`, and other unknown flags exit 1 with USAGE.
- [ ] Paths outside `lib/test/unit-tests/` exit 1. `--skip` still works.
- [ ] The lib linter passes.

**Validation**

From the repo root:

- `node lib/run-tests.js; echo "exit=$?"` — all unit tests pass (1846 at planning time; record the count) and `exit=0`.
- `(cd lib && node run-tests.js test/unit-tests/kixx/logger); echo "exit=$?"` — passes; cwd independence.
- `node lib/run-tests.js lib/test/unit-tests/kixx/logger --skip lib/test/unit-tests/kixx/logger; echo "exit=$?"` — `Ran 0 tests`, `exit=0`.
- `node lib/run-tests.js --e2e; echo "exit=$?"` and `node lib/run-tests.js --development; echo "exit=$?"` — unknown option, USAGE, `exit=1`.
- `node lib/run-tests.js test-app/test; echo "exit=$?"` and `node lib/run-tests.js lib/test/fixtures; echo "exit=$?"` — outside the test root, `exit=1`.
- `node lib/run-linter.js lib; echo "exit=$?"` — `exit=0`.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

### Task T5: Update docs for the test-app e2e workflow

**Status:** Not started
**Depends on:** T1, T2, T3, T4
**Documentation:** All files listed below

**Objective**

Every doc describes the new arrangement accurately. The e2e suite and its runner live in `test-app/`. The release workflow is build, deploy, `npm install`, then run e2e. lib holds only unit tests. No doc points at `lib/test/end-to-end`, `--e2e`, the wrong Cloudflare host, the deleted `docs/admin-files.md`, or the nonexistent `070-admin-assignment.test.js`.

**Scope**

- In: `test-app/test/README.md`, `test-app/README.md`, `lib/test/unit-tests/README.md`, `lib/docs/admin-data-api.md`, root `README.md`.
- Out: code changes (T1–T4), the journal (per task), and the completed build-tool plan (T1 adds its note).

**Design and invariants**

- `test-app/test/README.md` (the moved e2e README):
  - Commands run from `test-app/`: `node run-tests.js --development`, `--cloudflare`, `--nodejs`, `--base-url ...`. Drop `--e2e` everywhere.
  - Add a short prerequisite: `npm install` in `test-app/`, a built `test-app/` (`node tools/build-test-app.js` from the repo root), and a running or deployed target. For `--development`, the local server is `node node-server.js` from `test-app/`. Check that this matches `test-app/README.md`.
  - Remove the "These options are only valid with `--e2e`" paragraph. Keep "Each option may appear only once per run."
  - Fix the target table: `--cloudflare` → `https://kixx-test-app.kixx.workers.dev/`.
  - Subset examples use `test/010-csrf`, `test/010-csrf/010-form-lifecycle.test.js`, and `--skip test/200-publishing-api/060-running-build.test.js`. Containment text: pathnames must resolve inside `test/` (test-app/test). Remove the "forgotten or misspelled `--e2e`" rationale.
  - Large uploads: `node test/100-admin-files/large-upload-checks.js`, run from `test-app/`. Per R1, remove the `docs/admin-files.md` link and keep the list of what the script checks.
  - Per R2, remove `070-admin-assignment.test.js`: from the `--development` disabled list, its whole section, and the "What a run leaves behind" sentence, which then names only `060-running-build.test.js`.
  - Leave unrelated content unchanged.
- `test-app/README.md`: add a "Release testing" (or similar) section with numbered steps: 1. build (`node tools/build-test-app.js` from the repo root); 2. deploy test-app to the Cloudflare Worker and the Node.js server (no automation; name the devkit commands only after verifying them in `devkit/commands/README.md`, otherwise say "deploy" generically); 3. `npm install` in `test-app/` (first time, or after `package.json` changes); 4. run e2e from `test-app/`: `node run-tests.js --cloudflare` / `--nodejs` (and `--development` locally). Link to `test/README.md`. Update the "Only the config above is tracked" line to also list `package.json`, `package-lock.json`, `run-tests.js`, and `test/`, and say that the build keeps them along with `node_modules/`.
- `lib/test/unit-tests/README.md` line 12: drop the `test/end-to-end` and `--e2e` sentence. Replace it with a short note that e2e tests live in `test-app/test/` (see `test-app/test/README.md` from the repo root).
- `lib/docs/admin-data-api.md` around line 368: `test/end-to-end/300-admin-data-api/` becomes the test-app suite (for example "`test-app/test/300-admin-data-api/` (repo root)"). This doc ships with lib and is copied into test-app, so phrase the path so it reads correctly in both places.
- Root `README.md` test-app line: mention that it holds the e2e suite and runner, run before a release.

**Expected touch points**

- `test-app/test/README.md`, `test-app/README.md`, `lib/test/unit-tests/README.md`, `lib/docs/admin-data-api.md`, `README.md`.

Treat this list as orientation, not permission to ignore other necessary files. Record the actual files changed in the handoff notes.

**Acceptance criteria**

- [ ] The stale-reference grep below prints only the expected devkit line.
- [ ] `test-app/README.md` documents the four-step release workflow and the tracked and kept files.
- [ ] `test-app/test/README.md` commands are runnable as written from `test-app/` (review only; do not run them).
- [ ] Docs only; no code changes.

**Validation**

From the repo root:

- `grep -rn "test/end-to-end\|--e2e\|cloudflare.kixx-testing.dev\|070-admin-assignment\|admin-files.md" README.md lib/docs lib/test lib/run-tests.js test-app/README.md test-app/test test-app/run-tests.js tools devkit --exclude-dir=node_modules` prints only `devkit/test/run-tests.test.js` lines (devkit's own unknown-flag test).
- `grep -n "kixx-test-app.kixx.workers.dev" test-app/test/README.md test-app/run-tests.js` matches in both files.
- `node lib/run-tests.js; echo "exit=$?"` and `node lib/run-linter.js lib; echo "exit=$?"` both print `exit=0` (sanity; no code changed).
- Manual review: read each edited doc once end to end for accuracy against T1–T4.

**Progress and handoff**

- Completed: Nothing yet.
- Current state: Not started.
- Remaining: Everything described above.
- Decisions and discoveries: None yet.
- Actual files changed: None yet.
- Validation run: None yet.
- Blockers: None.

---

Operator Runbook
----------------

Do these after T1–T5 land. They are not agent validation steps.

- [ ] `cd test-app && npm install` (or `npm ci`) on each machine that runs e2e.
- [ ] From the repo root, run `node tools/build-test-app.js` and confirm exit 0. Then confirm `test-app/run-tests.js`, `test-app/test/`, `package.json`, `package-lock.json`, and `node_modules/` survived.
- [ ] Locally: `node test-app/node-server.js`, then from `test-app/` run `node run-tests.js --development` with root credentials.
- [ ] Deploy test-app to Cloudflare and the Node.js server, then from `test-app/` run `node run-tests.js --cloudflare` and `node run-tests.js --nodejs`.
- [ ] `git status --short test-app` shows no secrets or `node_modules`.
