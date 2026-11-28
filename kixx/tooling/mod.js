/**
 * Core's tooling: what reads plugin manifests, generates a project's
 * registries, and compiles its content. It imports no platform module, so a
 * command line tool can load a project's own copy of it and it can run in any
 * runtime.
 *
 * A tool on Node.js or Deno loads three modules from the project's `kixx/`:
 *
 * - `tooling/mod.js`, this file;
 * - `adapters/node/tooling/lib/project-file-system.js`, which reads the
 *   manifests (`createProjectFileSystem()`);
 * - `adapters/node/content-compiler/lib/file-system-content-source.js`, which
 *   reads the content (`createFileSystemContentSource()`).
 *
 * It passes both to `compileProjectContent()`.
 *
 * The parsers of the two config dialects a tool reads as data are here too:
 * `parseJsonc()` for a `.jsonc` file and `parseSecretsManifest()` for
 * `example.env.secrets`. A tool that parsed them itself could disagree with
 * the app about what a file says.
 *
 * The path classification (content, agent file, test, docs, or code), the
 * code fingerprint, and the `git ls-tree -r -z` parser that feeds it come from
 * the code fingerprint module and are re-exported here.
 *
 * So do the content contract version and the addressing format the compiler
 * writes, which a publishing tool checks against the server before any write.
 *
 * A running app needs no manifest read. It passes the `contentRoots` and
 * `templateHelpers` exports of its generated registry to `compileContent()`.
 * @module tooling
 */
export { validatePluginManifest, validateAppManifest } from './plugin-manifest.js';
export { resolveInstallation } from './resolve-installation.js';
export {
    renderRegistryFiles,
    NODE_REGISTRY_FILE_NAME,
    CLOUDFLARE_REGISTRY_FILE_NAME,
    DURABLE_OBJECT_REGISTRY_FILE_NAME,
    ROUTES_REGISTRY_FILE_NAME,
    SECRETS_MANIFEST_FILE_NAME,
} from './render-registries.js';
export { readInstallation, renderProjectFiles, writeProjectFiles } from './generate-project-files.js';
export { listPluginContentRoots } from './project-paths.js';
export { compileProjectContent } from './compile-project-content.js';
export { parseJsonc } from '../config/parse-jsonc.js';
export { parseSecretsManifest } from '../config/secrets-manifest.js';
export { compileContent, serializeContentObject } from '../content-compiler/mod.js';
export { CONTENT_CONTRACT_VERSION } from '../content-addressable-store/content-addressable-store.js';
export { FORMAT as ADDRESSING_FORMAT } from '../content-addressable-store/addressing.js';
export {
    PATH_CLASSES,
    classifyPath,
    createPathClassifier,
    CODE_FINGERPRINT_FORMAT,
    computeCodeFingerprint,
    isValidCodeFingerprint,
    isValidGitObjectId,
    parseGitLsTree,
} from '../code-fingerprint/mod.js';
