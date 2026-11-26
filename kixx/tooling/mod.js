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
export { compileContent, serializeContentObject } from '../content-compiler/mod.js';
