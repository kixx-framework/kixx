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

## Computing the Fingerprint

```javascript
import { computeCodeFingerprint } from './kixx/code-fingerprint/mod.js';

const fingerprint = await computeCodeFingerprint({ entries, contentRoots });
// 'kxfp1:0d3b0f27…'
```

`entries` holds every file in the commit's tree, one `{ path, mode, oid }` per file, in any order. The function classifies each path, keeps the code entries, and hashes them. It is async only because `crypto.subtle` is.

Entry rules. A violation throws an `AssertionError` naming the entry's index, since it is a caller's bug:

- `path` follows the path rules under "Path Classification". Paths are unique.
- `mode` is one of `100644`, `100755`, `120000` (symbolic link), or `160000` (gitlink) (`GIT_FILE_MODES`). A recursive listing never includes a tree (`40000`).
- `oid` is the git object id, 40 (SHA-1) or 64 (SHA-256) lowercase hex characters, the same length for every entry.

An empty code set is allowed. It hashes the header alone.

`isValidCodeFingerprint(value)` checks a fingerprint's shape in any format version (`/^kxfp[1-9][0-9]*:[0-9a-f]{64}$/`). `isValidGitObjectId(value)` checks a commit or object id.

## Fingerprint Format

Format 1 (`CODE_FINGERPRINT_FORMAT`). The bytes hashed with SHA-256 are the UTF-8 encoding of:

1. The header `kixx code fingerprint 1` and a line feed (`\n`).
2. For each code entry, sorted by the UTF-8 bytes of its full path: `<mode> <oid>\t<path>\0`. That is the mode, one space, the oid, one tab, the path, and one NUL.

The fingerprint is `kxfp1:` followed by the lowercase hex digest.

The mode and oid have fixed character sets and the path ends at the NUL, which no git path contains, so the serialization is unambiguous. The mode is included so an executable-bit or symbolic link change counts as a code change; a blob id doesn't encode the mode.

Sorting is by UTF-8 bytes, not JavaScript's default string order (UTF-16 code units) and not a directory walk's order: `a.b` sorts before `a/b`, and `app/Ａ.js` (U+FF21) before `app/😀.js` (U+1F600).

A worked example, from the golden vectors. With `plugins/visits/pages` installed as a content root, this tree:

```
100644 ce013625030ba8dba906f756967f9e9ca394464a  .github/workflows/ci.yml
100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391  a.b
100644 ce013625030ba8dba906f756967f9e9ca394464a  a/b
100644 ff8b4c56321a3362fc00224b01800f62466f9a1f  app/app.js
100644 ff8b4c56321a3362fc00224b01800f62466f9a1f  app/été.js
100644 ff8b4c56321a3362fc00224b01800f62466f9a1f  app/Ａ.js
100644 ce013625030ba8dba906f756967f9e9ca394464a  app/😀.js
100755 4163036efa65bd4a469e752267498f01ea36a55c  bin/run.sh
120000 43207e355e463499468d756d158c4b1cc159393a  current
100644 e69de29bb2d1d6434b8b29ae775ad8c2e48c5391  kixx.lock.json
160000 0123456789abcdef0123456789abcdef01234567  vendor/lib
```

plus `pages/page.json`, `plugins/visits/pages/p/page.json`, `README.md`, `AGENTS.md`, `test/app.test.js`, and `docs/guide.html` (all excluded), hashes the header and the eleven code records in the order shown, for example `100644 ce013625030ba8dba906f756967f9e9ca394464a\t.github/workflows/ci.yml\0` first. The result is `kxfp1:0d3b0f2732c78e40cad4a89b85a35d37be2458aa5565454516e1bdefb526c5aa`. With no code entries the result is `kxfp1:2f1be9249aa4c911443314618a90dd1d3fb059b31829056b7fabdbfc6f588136`.

## Feeding the Fingerprint

Both feeders must produce the same entries from the same commit.

**The command line tool** runs `git ls-tree -r -z <commit>` in the project and passes its raw standard output (bytes, not a decoded string) to `parseGitLsTree()`:

```javascript
import { computeCodeFingerprint, parseGitLsTree } from './kixx/tooling/mod.js';

const entries = parseGitLsTree(stdoutBytes);
const fingerprint = await computeCodeFingerprint({ entries, contentRoots });
```

`parseGitLsTree()` takes an `ArrayBuffer`, a `Uint8Array`, or a string, and reads each NUL-terminated record as `<mode> <type> <oid>\t<path>`. It accepts types `blob` and `commit` (a gitlink) only, each with its matching modes, and decodes paths as strict UTF-8. A malformed record, or a path that isn't UTF-8, throws a `ValidationError` naming the record's index. `-z` output is never quoted, so `core.quotePath` doesn't matter.

**Studio** walks the commit's tree in its workspace's git objects (the workspace engine's tree listing gives a `Map` of path to `{ oid, mode }`), strips the leading `/` from each path, and passes the entries directly.

`contentRoots` must be the installation's content roots: a registry's `contentRoots` export in a running app, or `listPluginContentRoots()` in a tool.

**Golden vectors.** `test/kixx/code-fingerprint/code-fingerprint-goldens.js` exports a suite, `(group, getSubject)`, where `getSubject()` returns `{ computeCodeFingerprint, classifyPath }`. It imports only by relative path, so another feeder's tests can run it. It also exports the golden tree, blobs, and ids. Its expected values were produced with git and Python's hashlib, never with this module.

## Versioning

The format version is part of every fingerprint and of the hashed header. Any change to the header, the record layout, the sorting, the entry rules, or the classification table is a new version.

A server accepts any version's shape, so a new format needs no server change. A build fingerprinted under one version mismatches a commit fingerprinted under another, which refuses content-only publishes to that build until the next deploy.
