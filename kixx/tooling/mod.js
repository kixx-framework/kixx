/**
 * Core's tooling: what reads plugin manifests and generates a project's
 * registries. It imports no platform module, so a command line tool can load
 * a project's own copy of it and it can run in any runtime.
 * @module tooling
 */
export { validatePluginManifest, validateAppManifest } from './plugin-manifest.js';
export { resolveInstallation } from './resolve-installation.js';
