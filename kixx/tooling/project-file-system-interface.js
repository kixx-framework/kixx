/**
 * ProjectFileSystemInterface — the contract for the file access the registry
 * generator needs: read a manifest, list the installed plugins, and write a
 * generated file. Core's tooling imports no platform module, so its caller
 * hands it an implementation: the Node.js adapter in a command line tool, or
 * an in-memory fake in a unit test.
 *
 * ## Paths
 * - Every path is a POSIX path relative to the project root (`plugins`,
 *   `app/app.json`).
 * - A path MAY begin with `../`, to reach a core that lives outside the
 *   project. An implementation MUST resolve it against the project root and
 *   MUST NOT reject it for leaving the project.
 *
 * ## Invariants
 * - Every method is async.
 * - A file or directory that doesn't exist is a normal answer (`null`, `[]`),
 *   never a rejection. Any other failure rejects.
 * - `listDirectories` MUST return its names sorted by code unit, so the
 *   generator reads manifests in the same order on every machine.
 * - Text is UTF-8.
 */

/**
 * File access for the registry generator.
 *
 * @typedef {Object} ProjectFileSystemInterface
 *
 * @property {function(string): Promise<string|null>} readTextFile
 *   Resolves the UTF-8 text of the file at `path`, or `null` when there is no
 *   such file.
 *
 * @property {function(string): Promise<string[]>} listDirectories
 *   Resolves the names of the directories directly inside `path`, sorted, or
 *   `[]` when `path` doesn't exist. Anything that isn't a directory is left
 *   out.
 *
 * @property {function(string, string): Promise<void>} writeTextFile
 *   Writes `text` to the file at `path` as UTF-8, replacing the file.
 */
