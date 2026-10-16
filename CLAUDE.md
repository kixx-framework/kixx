@README.md

---

Kixx Library
------------

Notes for developers and agents working on the Kixx Library (`lib/`, usually just "Kixx").

**Read the docs first.** Before changing code in `lib/`, read `lib/docs/doc-index.md`. It lists every guide and reference with a summary. Read the ones relevant to your task.

**Run tests and lint** from the repo root:

```
node lib/run-tests.js                  # full suite on Node.js
deno run -A lib/run-tests.js           # full suite on Deno
node lib/run-tests.js lib/test/kixx    # a subtree (must be inside lib/test/)
node lib/run-linter.js lib             # lint
```

**Keep the layers apart.**

- `kixx/` is framework code. `app/`, `pages/`, `templates/`, and the other site folders are the starter app.
- Platform differences live only in `plugins/` and the entry points (`node-server.js`, `cloudflare-server.js`). Code under `app/` never imports from `plugins/` or a native module (`node:*`, `cloudflare:*`). See `lib/plugins/README.md`.
- Every change must work on Node.js and Cloudflare.
- `kixx/vendor/` is third-party code. Leave it alone.

**Update the code that depends on `lib/`.**

- The devkit ports some `lib/` modules: `kixx/config/parse-jsonc.js`, `kixx/config/secrets-manifest.js`, and `kixx/content-addressable-store/{addressing,content-layout}.js`. When you change one, change its devkit copy in the same commit (see `devkit/docs/architecture.md`), then run `node devkit/run-tests.js devkit/test/conformance`. Those tests also bundle and scan `lib/` and read its config and env files, so run them after changing entry points, config, or `lib/example.env*` too.
- When public behavior changes, update `usage-docs/kixx-app/`.
- `test-app/` is a copy of `lib/` built by `node tools/build-test-app.js`. Don't edit its copied code.

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

**Keep it stand-alone.** The devkit ships to npm and JSR on its own.

- Never import from outside `devkit/`. Only `devkit/test/conformance/` may read `lib/`.
- No runtime dependencies. Use `node:` built-ins, or vendor the code into `devkit/lib/vendor/` (and leave vendored code alone).
- It must run on Node.js and Deno.
- Keep `package.json` and `deno.json` in sync, including the version. See `devkit/docs/packaging-and-runtimes.md`.

**Keep commands thin.** A command in `commands/` wires options and settings to one call into `devkit/lib/`, where the logic lives. Add a command by following `devkit/commands/README.md`. Throw `UsageError` for anything the user can fix (see `devkit/docs/error-handling.md`).

**Update what depends on the devkit.**

- Ported `lib/` modules must match the originals. Change both sides together and run `node devkit/run-tests.js devkit/test/conformance`.
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

Journal
-------

Keep a timestamped journal of your activity in `agents/journal/`. The journal should have one file per day, formatted as `YYYY-MM-DD.md`, and each entry should have a complete ISO timestamp including the date, and time, down to the minute, in the America/New_York (eastern) time zone.

When commiting your changes, be sure to commit the journal updates with them.

Helpful Tips
------------

When writing something intended for human consumption, (comment, commit message, reply to prompt) use as few words as possible. Get to the point. Less is more.

Let the reader of the code breathe. Add empty lines between logical blocks of code.
