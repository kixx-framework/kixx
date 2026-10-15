import { isNonEmptyString } from '../vendor/kixx-assert/mod.js';


// Excluded only at the top level of the project: lib keeps server code in
// nested directories with these names (kixx/static-assets/, forms/pages/).
const EXCLUDED_TOP_LEVEL_DIRECTORIES = new Set([
    'pages',
    'templates',
    'static-assets',
    'public',
    'emails',
    'test',
]);

const TRIGGER_FILE_NAMES = new Set([
    'node-config.jsonc',
    'example.env.secrets',
]);


/**
 * Decides whether a changed file should restart the app server. These are
 * the files node-server.js only reads at startup; templates, pages, and
 * static assets are read live in development.
 *
 * @param {string|null|undefined} relativePath - Path relative to the real
 *   project directory, as reported by a recursive fs.watch().
 * @returns {boolean} True for a trigger. A missing path counts as a trigger,
 *   since a missed restart is worse than an extra one.
 */
export function isRestartTrigger(relativePath) {
    if (!isNonEmptyString(relativePath)) {
        return true;
    }

    const segments = relativePath.replace(/\\/g, '/').split('/');
    const basename = segments.pop();

    if (segments.some((segment) => segment === 'node_modules' || segment.startsWith('.'))) {
        return false;
    }

    if (segments.length > 0 && EXCLUDED_TOP_LEVEL_DIRECTORIES.has(segments[0])) {
        return false;
    }

    return basename.endsWith('.js')
        || basename.endsWith('.mjs')
        || TRIGGER_FILE_NAMES.has(basename)
        || basename === '.env'
        || basename.startsWith('.env.');
}
