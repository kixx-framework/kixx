/**
 * ContentSourceInterface — the contract for the file access the content
 * compiler needs: list the files beneath a directory, and read one file's
 * bytes. The compiler imports no platform module, so its caller hands it an
 * implementation: the Node.js adapter over a working tree, or the in-memory
 * source in a unit test. The port is read-only.
 *
 * ## Paths
 * - Every path is a POSIX path relative to the source's root, which is the
 *   project root (`pages`, `templates/partials`, `pages/about/page.json`).
 * - A path has no leading `/` and no empty, `.`, or `..` segment, so no path
 *   can leave the root. An implementation MUST assert this before it reads
 *   anything.
 *
 * ## Invariants
 * - Every method is async.
 * - A file or directory that doesn't exist is a normal answer (`null`,
 *   `kind: 'missing'`), never a rejection. Any other failure rejects.
 * - A symbolic link is listed and never followed: nothing beneath a linked
 *   directory appears in a listing.
 * - An entry that is neither a regular file, a directory, nor a symbolic link
 *   is left out of a listing.
 * - Entries MAY come in any order. The compiler sorts them.
 * - An empty directory has no entries, so the compiler can't see it.
 * - `readFile` returns a buffer the caller owns: changing it changes no later
 *   read.
 * - What `readFile` answers for a path that is, or lies beneath, a symbolic
 *   link is not defined. The compiler reads only paths a listing gave it as
 *   `file`.
 */

/**
 * @typedef {Object} ContentSourceEntry
 * @property {string} path - POSIX path relative to the listed directory
 * @property {'file'|'symlink'} type - A symbolic link is listed, never followed
 */

/**
 * @typedef {Object} ContentSourceListing
 * @property {'directory'|'symlink'|'missing'} kind - What `directory` is. 'missing' also covers a path that is a file.
 * @property {ContentSourceEntry[]} entries - Every file and symbolic link beneath the directory, found recursively. Empty unless kind is 'directory'.
 */

/**
 * File access for the content compiler.
 *
 * @typedef {Object} ContentSourceInterface
 *
 * @property {function(string): Promise<ContentSourceListing>} listFiles
 *   Resolves what the directory at `directory` is and, when it is a
 *   directory, every file and symbolic link beneath it.
 *
 * @property {function(string): Promise<ArrayBuffer|null>} readFile
 *   Resolves the exact bytes of the file at `path`, or `null` when there is
 *   no such file. A directory is not a file.
 */
