@README.md

---

Kixx Core
---------

Notes for developers and agents working on Kixx core (`kixx/`, usually just "Kixx"). The layout is in README.md.

**Read the docs first.** Before changing core, read `docs/doc-index.md`. It lists every guide and reference with a summary. Read the ones relevant to your task.

**Run tests and lint** from the repo root, after a one-time `npm install`:

```
node run-tests.js                  # full suite on Node.js
deno run -A run-tests.js           # full suite on Deno
node run-tests.js test/kixx/logger # a subtree (must be inside test/)
node run-linter.js                 # lint everything the root config covers
node run-linter.js kixx test       # lint a subset (pass only paths that exist)
node run-linter.js test-app        # lint the integration suite
```

**Read the Testing Guide before you write a test:** `test/README.md`. It says which suite a test belongs in, how a module gets its platform services, how to keep a Durable Object thin, how to write a fake, and how to write a conformance suite.

- `run-tests.js` runs the unit suite only: Kixx code against fakes, with no network and no credentials.
- The integration suite lives in `test-app/` and runs against a real target. Agents write its tests. CI runs them against a test app on the runner (`test-app/run-local.js`), and the operator runs them locally and against deployed targets. Never run `test-app/run-tests.js` or `test-app/run-local.js` yourself, and never deploy: push, then read the `integration-local` CI job. See `test-app/README.md`.

**Keep the layers apart.**

- Core under `kixx/` never imports outside `kixx/`.
- Core outside `kixx/adapters/` never imports an adapter. Adapters are reached through generated registries and entry points.
- `node:*` modules appear only in `kixx/adapters/`.
- `cloudflare:*` modules appear only in the Durable Object shells and the Cloudflare-only modules listed in `test/kixx/import-hygiene.test.js`. A shell passes `ctx` and `env` to a plain class that holds all the behavior, delegates each RPC method in one line, and does nothing else. List a new shell there.
- A module takes every platform service it uses from its caller: bindings, storage handles, `fetch`, clocks, and output sinks. A unit test hands it a fake from `test/fakes/`.
- Unit tests never import a Durable Object shell, an entry point, or a `cloudflare:*` module.
- `test/kixx/import-hygiene.test.js` enforces the import rules above.
- The plugin guide is `plugins/README.md`: manifests, lifecycle modules, generated registries, entry points, and the ports-and-adapters rules.
- Files named `*.generated.js` and `example.env.secrets` are generated from the plugin manifests. Never edit one. Change a manifest, then regenerate: `node tools/generate-registries.js test/fixtures/project --core ../../../kixx`. A test fails on drift. A real project regenerates with `kixx-dev generate`; the fixture can't, because its core lives outside it. A generated JavaScript file turns lint off for itself.
- `node tools/build-project.js <directory>` builds a project with no plugins from the skeleton (`devkit/templates/project/`) and core, and runs the generator. Build one under `tmp/` to try a change in a real project. It replaces a directory it built before and refuses any other directory that isn't empty.
- `node tools/build-test-app.js` builds the integration suite's test app into `test-app/build/` (git-ignored): the skeleton, core, and the test-only plugin in `test-app/integration-probe/`. Building it runs nothing. Never edit, lint, or commit the build.
- Every change must work on Node.js, Deno, and Cloudflare.
- Vendored code (`kixx/vendor/`, `kixx/errors/`, `kixx/assertions/`, `devkit/lib/vendor/`) is never edited in place. It changes only by following `docs/vendored-code.md`.

**v6 material.**

- `reference-app/` and `test-v6/` aren't maintained and may be broken. Don't run, lint, or fix them.
- When you change, move, or keep a module, bring its tests back from `test-v6/` with `git mv` (never copy), fix their imports, and make them pass. Tests must not read files by cwd-relative path or from `reference-app/`.
- When a `test-v6/` file mixes cases for the current work with cases for code a later section reworks, split it. `git mv` the file into the active suite in a commit that holds only renames. Then trim the moved copy to the cases that cover the current work, and restore the rest at the old path unchanged. Delete cases that cover removed code. The parked rest waits for its own section.
- The v6 devkit ports four core modules: `kixx/config/parse-jsonc.js`, `kixx/config/secrets-manifest.js`, and `kixx/content-addressable-store/{addressing,content-layout}.js`. Most of the devkit's conformance tests are still parked in `test-v6/devkit/conformance/` and don't run; `devkit/test/conformance/content-contract.test.js` runs. The devkit's contract pin (`devkit/lib/publishing/negotiate-capabilities.js`) and the manifest shape it composes must stay in step with core. The four ported modules needn't be kept in step until the devkit sections decide their fate.
- The v6 integration suites wait in `test-v6/test-app/` until they are rewritten for v7. Their runner moved to `test-app/`.
- When public behavior changes, update `usage-docs/kixx-app/`.

Kixx Devkit
-----------

Notes for developers and agents working on the Kixx Devkit (`devkit/`, the `kixx-dev` CLI).

**Read the docs first.** Before changing code in `devkit/`, read `devkit/docs/doc-index.md`. It lists every guide and reference with a summary. Read the ones relevant to your task.

**Run tests and lint** from the repo root:

```
node devkit/run-tests.js                     # full suite on Node.js
deno run -A devkit/run-tests.js              # full suite on Deno
node devkit/run-tests.js devkit/test/lib     # a subtree (must be inside devkit/test/)
node devkit/run-linter.js devkit             # lint
node devkit/kixx-dev.js <command>            # run the CLI from source
```

Some devkit tests are back from `test-v6/devkit/`, so `node devkit/run-tests.js` runs them. The rest come back with their sections. CI lints the devkit and runs its suite on Node.js and Deno (`devkit-lint`, `devkit-test-node`, `devkit-test-deno`).

**Keep it stand-alone.** The devkit ships to npm and JSR on its own.

- Never import from outside `devkit/`. Only `devkit/test/conformance/` may read core (`kixx/`).
- At run time the devkit takes framework logic from the project it runs in, never from a copy of its own. `devkit/lib/project/load-project-tooling.js` imports the project's `kixx/tooling/mod.js` and two adapter modules, and is the only module with a dynamic `import()`. A command declares `requiresTooling` and takes the result as its `tooling` argument. Never use `instanceof` on something project code made or threw: match `error.name`.
- `devkit/test/import-hygiene.test.js` enforces both rules.
- This repository's root holds `kixx/plugin.json`, so from inside it `kixx-dev` finds the repository root as the project. Never run `kixx-dev generate` here outside a built project (`tmp/core-only`, for example): it would write five generated files at the repository root. Always pass the project directory.
- No runtime dependencies. Use `node:` built-ins, or vendor the code into `devkit/lib/vendor/` by following `docs/vendored-code.md` (and never edit vendored code in place).
- It must run on Node.js and Deno.
- Keep `package.json` and `deno.json` in sync, including the version, which equals `kixx/plugin.json`'s. See `devkit/docs/packaging-and-runtimes.md`.
- `node:child_process` is imported only by the modules listed in `devkit/test/import-hygiene.test.js`.

**The project skeleton** is `devkit/templates/project/`: the hand-written files a new project is copied from. It is data to the devkit.

- Its files import core as `./kixx/...`. Never import, run, or lint one in place.
- It holds no `*.generated.js` file, no `example.env.secrets`, and no `kixx/` directory.
- Code in its `app/` and its `virtual-hosts.js` imports no `node:*` or `cloudflare:*` module and no adapter. Its entry points import exactly what `plugins/README.md` lists.
- Its config files hold only what has no default.
- `test/kixx/import-hygiene.test.js` enforces the import rules. List a new entry point there.

**Keep commands thin.** A command in `commands/` wires options and settings to one call into `devkit/lib/`, where the logic lives. Add a command by following `devkit/commands/README.md`. A command returns data and writes human text to its injected `output`; it never picks an exit code. Throw `UsageError` for anything the user can fix (see `devkit/docs/error-handling.md`). The `--json` envelope and the exit-code table are a stable interface: change them by addition only.

**Update what depends on the devkit.**

- Ported core modules: see "v6 material" above.
- When a command's behavior or options change, update its page in `usage-docs/kixx-devkit/` and the command list in `devkit/README.md`.
- A change needing a new Deno permission must update the install commands in `devkit/README.md` and the `kixx-dev` task in `devkit/deno.json`.

Commit Messages
---------------

When you write a commit message, follow these rules:

- Separate the subject line from the body with a single blank line.
- Limit the subject line to 50 characters (72 is the absolute hard limit).
- Capitalize the first letter of the subject line.
- Do not end the subject line with a period.
- Use the imperative mood in the subject line (e.g., "Fix bug," "Add feature," not "Fixed" or "Adds"). Test formula: It must complete the sentence: "If applied, this commit will [your subject line here]".
- Wrap the body text manually at 72 characters to prevent Git formatting issues.
- Use the body to explain what and why vs. how. Assume the code explains the how; the message must explain the context and reasoning.

Temporary Scratchpad
--------------------

Use the `tmp/` directory as a temporary scratchpad to:

- Download assets to disk
- Write temporary Python, Bash, or Node.js scripts
- Jot down ephemeral notes or anything you might want to persist for later.

Don't worry about cleaning up the `tmp/` directory. We periodically sweep it to clear out old files and sub-directories when it is not in use.

Helpful Tips
------------

When writing something intended for human consumption, (comment, commit message, reply to prompt) use as few words as possible. Get to the point. Less is more.

Let the reader of the code breathe. Add empty lines between logical blocks of code.

When working on a task, exploring local files, or experimenting with a proof-of-concept, lean toward writing Python, Bash, and Node.js scripts in the tmp/ directory to make your work more efficient. These scripts can be throwaway code and will often be more efficient than chaining tool calls.
