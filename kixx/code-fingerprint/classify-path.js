import { AssertionError, isNonEmptyString, isPlainObject, isString, isUndefined } from '../assertions/mod.js';


/**
 * Every class a project path can have (D40). Only `code` paths count in the
 * code fingerprint. There is deliberately no other excluded class: every
 * path outside content, agent files, tests, and docs is code.
 * @type {{CONTENT: 'content', AGENT: 'agent', TEST: 'test', DOCS: 'docs', CODE: 'code'}}
 */
export const PATH_CLASSES = Object.freeze({
    CONTENT: 'content',
    AGENT: 'agent',
    TEST: 'test',
    DOCS: 'docs',
    CODE: 'code',
});

// Content directories at the project root (REQ §2).
const ROOT_CONTENT_DIRECTORIES = [ 'pages', 'templates', 'static-assets', 'public' ];

const ROOT_AGENT_DIRECTORIES = [ '.agents', '.claude', '.codex' ];

const AGENT_FILE_NAMES = new Set([ 'AGENTS.md', 'CLAUDE.md' ]);

const CONTENT_DIRECTORY_KEYS = [ 'pagesDirectory', 'templatesDirectory', 'staticAssetsDirectory' ];

// A lone surrogate has no exact UTF-8 encoding.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;


/**
 * @typedef {import('../tooling/project-paths.js').PluginContentRoot} PluginContentRoot
 */

/**
 * Says what is wrong with a project path, as git stores it: POSIX, relative
 * to the project root, with no leading or trailing `/`, no empty, `.`, or
 * `..` segment, no NUL, and no lone surrogate.
 * @param {*} path
 * @returns {string|null} The problem, or null when the path is valid
 */
export function findProjectPathProblem(path) {
    if (!isNonEmptyString(path)) {
        return 'must be a non-empty string';
    }
    if (path.includes('\0')) {
        return 'must not contain NUL';
    }
    if (LONE_SURROGATE.test(path)) {
        return 'must not contain a lone surrogate';
    }
    if (path.startsWith('/') || path.endsWith('/')) {
        return 'must not begin or end with "/"';
    }
    for (const segment of path.split('/')) {
        if (segment === '' || segment === '.' || segment === '..') {
            return 'must not have an empty, ".", or ".." segment';
        }
    }
    return null;
}

/**
 * Builds a classifier for one installation's content roots. The roots are
 * checked and normalized once.
 *
 * A root that begins with `../` (core outside the project, as in core's own
 * monorepo) is ignored: no git tree path can be there.
 *
 * @param {PluginContentRoot[]} [contentRoots=[]] - The `contentRoots` export of a generated registry, or what listPluginContentRoots() returns
 * @returns {function(string): string} Classifies a project path; returns a PATH_CLASSES value
 * @throws {AssertionError} When a root is absolute or otherwise unsafe
 */
export function createPathClassifier(contentRoots) {
    const pluginContentDirectories = readContentRoots(contentRoots);

    return function classify(path) {
        const problem = findProjectPathProblem(path);
        if (problem) {
            throw new AssertionError(`classifyPath: path ${ JSON.stringify(path) } ${ problem }`, null, classify);
        }

        const segments = path.split('/');
        const root = segments[0];
        const basename = segments[segments.length - 1];

        // 1. Content wins over everything, including README.md and AGENTS.md
        //    files inside a content directory.
        if (ROOT_CONTENT_DIRECTORIES.includes(root)) {
            return PATH_CLASSES.CONTENT;
        }
        if (pluginContentDirectories.some((directory) => isInside(path, directory))) {
            return PATH_CLASSES.CONTENT;
        }

        // 2. Agent files.
        if (AGENT_FILE_NAMES.has(basename) || ROOT_AGENT_DIRECTORIES.includes(root)) {
            return PATH_CLASSES.AGENT;
        }
        // Core is always vendored at kixx/ in a project (R1), so its
        // shipped skill and subagent sources are at kixx/agents/.
        if (root === 'kixx' && segments[1] === 'agents') {
            return PATH_CLASSES.AGENT;
        }
        if (root === 'plugins' && segments.length >= 3 && segments[2] === 'agents') {
            return PATH_CLASSES.AGENT;
        }

        // 3. Tests.
        if (root === 'test') {
            return PATH_CLASSES.TEST;
        }

        // 4. Docs.
        if (root === 'docs' || /\.md$/i.test(basename)) {
            return PATH_CLASSES.DOCS;
        }
        if (segments.length === 1 && (path === 'LICENSE' || path.startsWith('LICENSE.') || path.startsWith('LICENCE'))) {
            return PATH_CLASSES.DOCS;
        }

        // 5. Everything else can change what content renders against (D40).
        return PATH_CLASSES.CODE;
    };
}

/**
 * Classifies one project path. Use createPathClassifier() to classify many
 * paths against the same content roots.
 * @param {string} path - A POSIX path relative to the project root, as git stores it
 * @param {PluginContentRoot[]} [contentRoots=[]]
 * @returns {string} A PATH_CLASSES value
 * @throws {AssertionError} When the path or a content root is invalid
 */
export function classifyPath(path, contentRoots) {
    return createPathClassifier(contentRoots)(path);
}


function readContentRoots(contentRoots) {
    if (isUndefined(contentRoots)) {
        return [];
    }
    if (!Array.isArray(contentRoots)) {
        throw new AssertionError('createPathClassifier: contentRoots must be an array', null, createPathClassifier);
    }

    const directories = [];

    for (const root of contentRoots) {
        if (!isPlainObject(root)) {
            throw new AssertionError('createPathClassifier: each content root must be a plain object', null, createPathClassifier);
        }

        for (const key of CONTENT_DIRECTORY_KEYS) {
            if (isUndefined(root[key])) {
                continue;
            }

            const directory = normalizeContentDirectory(root[key]);
            if (directory === null) {
                continue;
            }

            const problem = findProjectPathProblem(directory);
            if (problem) {
                const name = isString(root.plugin) ? root.plugin : '(unnamed)';
                throw new AssertionError(
                    `createPathClassifier: ${ key } ${ JSON.stringify(root[key]) } of ${ name } ${ problem }`,
                    null,
                    createPathClassifier,
                );
            }

            directories.push(directory);
        }
    }

    return directories;
}

// Returns null for a root outside the project (it begins with "../").
function normalizeContentDirectory(directory) {
    if (!isString(directory)) {
        return directory;
    }
    if (directory.startsWith('../')) {
        return null;
    }

    let normalized = directory;
    while (normalized.startsWith('./')) {
        normalized = normalized.slice(2);
    }
    while (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}

function isInside(path, directory) {
    return path === directory || path.startsWith(`${ directory }/`);
}
