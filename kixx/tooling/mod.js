/**
 * Core's tooling: what reads plugin manifests and generates a project's
 * registries. It imports no platform module, so a command line tool can load
 * a project's own copy of it and it can run in any runtime.
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
