# Code Fingerprint

The code fingerprint says which code a commit's content was written against. A content-only publish goes live on a build only when its commit has the build's fingerprint (CONT-6, D6). The command line tool and Studio both compute it with this one module, so they always agree.

It imports no platform module, so the same code runs in a command line tool, a server, and a Worker.

Module paths here are from core's directory, which is `kixx/` in a project. `tooling/mod.js` re-exports everything below for a tool.

## Path Classification

Every project path has exactly one class: `content`, `agent`, `test`, `docs`, or `code` (`PATH_CLASSES`). Only `code` paths count in the fingerprint. The dev server's restarts use the same classes.

```javascript
import { classifyPath, createPathClassifier } from './kixx/code-fingerprint/mod.js';

classifyPath('plugins/visits/pages/page.json', contentRoots); // 'content'

const classify = createPathClassifier(contentRoots);
classify('app/app.json'); // 'code'
```

`contentRoots` is the `contentRoots` export of a generated registry, or what `listPluginContentRoots()` returns. It may be omitted when no plugin ships content. `createPathClassifier()` checks the roots once; use it to classify many paths.

Paths are POSIX, relative to the project root, as git stores them: no leading or trailing `/`, no empty, `.`, or `..` segment, no NUL, and no lone surrogate. An invalid path or content root throws an `AssertionError`.

Classification is by path only, never by file contents. Rows are checked in order; the first class that matches wins. Matching a directory means the path equals it or begins with it plus `/`. "At the root" means the first segment.

| Order | Class | Paths |
|---|---|---|
| 1 | content | `pages/`, `templates/`, `static-assets/`, and `public/` at the root, including any Markdown or agent file inside them |
| 1 | content | every installed plugin's content roots, for example `plugins/visits/pages/`. A root that begins with `../` (core outside the project) is ignored. |
| 2 | agent | `AGENTS.md` and `CLAUDE.md` at any depth |
| 2 | agent | `.agents/`, `.claude/`, and `.codex/` at the root |
| 2 | agent | `kixx/agents/` and `plugins/<name>/agents/` (core is always at `kixx/` in a project) |
| 3 | test | `test/` at the root |
| 4 | docs | `docs/` at the root |
| 4 | docs | any `*.md` file (the extension is matched case-insensitively) |
| 4 | docs | `LICENSE`, `LICENSE.*`, and `LICENCE*` at the root |
| 5 | code | everything else |

Every other rule is case-sensitive, as git paths are.

"Everything else" is deliberate (D40): anything outside content, agent files, tests, and docs can change what content renders against. So `kixx/` and `plugins/` outside their content and agent directories, `app/` (including `app/app.json`), every `plugin.json`, `routes/`, the entry points and generated registries, the config files, `package.json`, `deno.json`, `example.env`, `example.env.secrets`, and every tracked `.env.<env>` file are code. So are `.github/`, `.kixx/`, `kixx.lock.json`, `package-lock.json`, `deno.lock`, `.gitignore`, `.gitattributes`, `.editorconfig`, and `eslint.config.js`. A CI workflow edit or an `agents sync` therefore changes the fingerprint, and Studio waits for the next deploy (STU-19).

Changing this table changes every fingerprint, so every environment must be deployed after it lands.
