# Vendored Code

Kixx has no runtime npm dependencies. Code it needs from elsewhere is copied in ("vendored") and imported by relative path. Commands below run from the repository root.

## What Is Vendored

| Directory | Holds |
|---|---|
| `kixx/errors/` | kixx-server-errors |
| `kixx/assertions/` | kixx-assert |
| `kixx/vendor/<name>/` | One third-party or Kixx library per directory (acorn, marked, path-to-regexp, templating) |
| `devkit/lib/vendor/<name>/` | Code the CLI needs (acorn, kixx-assert) |

`vendored-code.json` has one entry per directory: what it is, which release it came from, and a digest of its bytes. `test/vendored-code.test.js` fails when a directory's bytes no longer match its digest, when a vendored directory has no entry, or when an entry has no directory. CI runs it.

## The Rules

- Copy a published release, unmodified, with its license.
- Never edit a vendored file in place. Not to fix a bug, not to restyle it. The code style guides don't apply to it.
- Kixx-written code never lives in a vendor directory. A wrapper around vendored code goes beside it (for example `devkit/lib/parse-javascript.js` around acorn).

## The File Set

- **Kixx libraries** (kixx-assert, kixx-server-errors, kixx-templating): exactly the files the package publishes, minus `package.json` and `deno.json`. For kixx-server-errors and kixx-templating that is `docs/`, `lib/`, `mod.js`, `README.md`, and `LICENSE`. For kixx-assert it is `mod.js`, `README.md`, and `LICENSE`.
- **Third-party code:** the files Kixx imports, plus the README and license. Each entry's `files` says what was copied from where, including renames (marked's `lib/marked.esm.js` and acorn's `dist/acorn.mjs` are each vendored as `mod.js`).

## Kixx Libraries Change Upstream First

kixx-assert, kixx-server-errors, and kixx-templating have their own repositories and releases. To change one:

1. Make the change on a branch in the library's repository and open a pull request there.
2. The maintainer merges and publishes a release.
3. Re-vendor that release into Kixx (below).

Never patch the vendored copy, even temporarily.

## Adding or Upgrading

1. Download the release into its own empty directory under `tmp/`:

   ```
   mkdir -p tmp/vendor-check/<name>-<version>
   npm pack <name>@<version> --pack-destination tmp/vendor-check/<name>-<version>
   tar -xzf tmp/vendor-check/<name>-<version>/<name>-<version>.tgz -C tmp/vendor-check/<name>-<version>
   ```

   For code taken from a source repository instead, download the tag's tarball from GitHub. Don't run anything from the download.

2. Replace the directory's contents with the file set. Remove the old files first, so nothing stale is left behind.
3. Compare with the download. This prints nothing when the copy is exact (for a Kixx library, add `--exclude=package.json --exclude=deno.json`):

   ```
   diff -r tmp/vendor-check/<name>-<version>/package kixx/vendor/<name>
   ```

4. Run `node run-tests.js test/vendored-code.test.js`. The failure message prints the directory's actual digest.
5. In `vendored-code.json`, add or update the entry: `version`, `source`, `files`, `sha256` (the printed digest), and `deviation` (remove it when the copy is exact). Keep entries sorted by `path`.
6. Run the full suites. Update any import whose path changed.

## Removing

Delete the directory and its entry in the same change, along with everything that imports it.

## The Record

Each entry in `vendored-code.json`'s `entries` array has:

| Field | Meaning |
|---|---|
| `path` | Directory, relative to the repository root |
| `name` | Upstream package or project |
| `version` | Upstream version |
| `source` | `npm:<name>@<version>` or `github:<owner>/<repo>@<tag-or-commit>` |
| `files` | What was copied from where, as a short sentence |
| `sha256` | Digest of the directory (below) |
| `deviation` | Optional. How the copy differs from the named release. Absent when the copy is exact. |

**Digest.** Collect every regular file under the directory, recursively, skipping files named `.DS_Store`. Any other entry type, such as a symlink, is an error. Sort the paths (relative to the directory, `/`-separated) with JavaScript's default string sort. For each file, form the line `<relativePath>\0<sha256 hex of the file's bytes>\n`. The digest is the SHA-256 hex of those lines joined, as UTF-8. Bytes are read raw, with no newline normalization.

## Deviations

An entry with a `deviation` is a known exception to the rules: a copy that matches no release, or that differs from the one it names. Fix it by vendoring a real release, never by editing the copy to match.
