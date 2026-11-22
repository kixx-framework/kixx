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
```

**Keep the layers apart.**

- Core under `kixx/` never imports outside `kixx/`.
- Platform modules (`node:*`, `cloudflare:*`) appear only in `kixx/adapters/`. `test/kixx/import-hygiene.test.js` enforces both rules. The v6 ports-and-adapters guide is `reference-app/plugins/README.md` until S07 replaces it.
- Every change must work on Node.js, Deno, and Cloudflare.
- `kixx/vendor/` is third-party code. Leave it alone.

**v6 material.**

- `reference-app/` and `test-v6/` aren't maintained and may be broken. Don't run, lint, or fix them.
- When you change, move, or keep a module, bring its tests back from `test-v6/` with `git mv` (never copy), fix their imports, and make them pass. Tests must not read files by cwd-relative path or from `reference-app/`.
- When a `test-v6/` file mixes cases for the current work with cases for code a later section reworks, split it. `git mv` the file into the active suite in a commit that holds only renames. Then trim the moved copy to the cases that cover the current work, and restore the rest at the old path unchanged. Delete cases that cover removed code. The parked rest waits for its own section.
- The v6 devkit ports four core modules: `kixx/config/parse-jsonc.js`, `kixx/config/secrets-manifest.js`, and `kixx/content-addressable-store/{addressing,content-layout}.js`. Most of the devkit's conformance tests are still parked in `test-v6/devkit/conformance/` and don't run; `devkit/test/conformance/content-contract.test.js` runs. The devkit's contract pin (`devkit/lib/publishing/negotiate-capabilities.js`) and the manifest shape it composes must stay in step with core. The four ported modules needn't be kept in step until the devkit sections decide their fate.
- `test-v6/test-app/` and `tools/build-test-app.js` are v6 and knowingly broken.
- When public behavior changes, update `usage-docs/kixx-app/`.

Kixx Devkit
-----------

Notes for developers and agents working on the Kixx Devkit (`devkit/`, the `kixx` CLI).

**Read the docs first.** Before changing code in `devkit/`, read `devkit/docs/doc-index.md`. It lists every guide and reference with a summary. Read the ones relevant to your task.

**Run tests and lint** from the repo root:

```
node devkit/run-tests.js                     # full suite on Node.js
deno run -A devkit/run-tests.js              # full suite on Deno
node devkit/run-tests.js devkit/test/lib     # a subtree (must be inside devkit/test/)
node devkit/run-linter.js devkit             # lint
node devkit/kixx.js <command> <subcommand>   # run the CLI from source
```

Some devkit tests are back from `test-v6/devkit/`, so `node devkit/run-tests.js` runs them. The rest come back with their sections.

**Keep it stand-alone.** The devkit ships to npm and JSR on its own.

- Never import from outside `devkit/`. Only `devkit/test/conformance/` may read core (`kixx/`).
- No runtime dependencies. Use `node:` built-ins, or vendor the code into `devkit/lib/vendor/` (and leave vendored code alone).
- It must run on Node.js and Deno.
- Keep `package.json` and `deno.json` in sync, including the version. See `devkit/docs/packaging-and-runtimes.md`.

**Keep commands thin.** A command in `commands/` wires options and settings to one call into `devkit/lib/`, where the logic lives. Add a command by following `devkit/commands/README.md`. Throw `UsageError` for anything the user can fix (see `devkit/docs/error-handling.md`).

**Update what depends on the devkit.**

- Ported core modules: see "v6 material" above.
- When a command's behavior or options change, update its page in `usage-docs/kixx-devkit/` and the command list in `devkit/README.md`.
- A change needing a new Deno permission must update the install commands in `devkit/README.md` and the `kixx` task in `devkit/deno.json`.

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
