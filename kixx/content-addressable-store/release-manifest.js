import { ValidationError } from '../errors/mod.js';
import {
    assertNonEmptyString,
    isNonEmptyString,
    isPlainObject,
    isString,
    isUndefined,
} from '../assertions/mod.js';
import { isValidHash } from './addressing.js';
import {
    RESERVED_PAGE_FILENAMES,
    getBaseTemplatesPath,
    getGlobalTemplatePartialsPath,
    getPageIncludesPath,
    getPageMetadataPath,
    getPagePartialsPath,
    getPageTemplatePath,
    getStaticAssetPath,
    isValidPathname,
    normalizePathname,
} from './content-layout.js';

/**
 * @module release-manifest
 *
 * Owns the client-supplied Release manifest contract and its conversion into
 * the flat file list consumed by ContentAddressableIndex. Every malformed
 * client value is accumulated into a ValidationError; callers may rely on a
 * successful result being safe to pass to content-layout pathname builders.
 */

const MANIFEST_FIELDS = new Set([
    'staticAssets',
    'globalTemplatePartials',
    'baseTemplates',
    'pages',
]);
const PAGE_FIELDS = new Set([ 'metadata', 'partials', 'includes', 'templates' ]);
const REFERENCE_FIELDS = new Set([ 'objectId', 'size' ]);
const STATIC_ASSET_REFERENCE_FIELDS = new Set([ 'objectId', 'size', 'mediaType' ]);
const TEMPLATE_FIELDS = new Set([ 'id', 'source' ]);

/**
 * Validates a complete Release manifest and converts it to index source files.
 * Omitted facets remain absent and never inherit from another Release.
 * @param {*} manifest - Client-supplied manifest
 * @returns {import('./content-addressable-index.js').IndexSourceFile[]} Flat validated file list
 * @throws {ValidationError} When any manifest field is malformed or collides
 */
export function validateReleaseManifest(manifest) {
    const error = new ValidationError('The Release manifest is invalid');
    if (!isPlainObject(manifest)) {
        error.push('The manifest must be a plain object', '/');
        throw error;
    }

    rejectUnknownFields(error, manifest, MANIFEST_FIELDS, '');

    const files = [];
    // Storage pathnames seen so far, and every directory above them, each with
    // the source of the first file that claimed it.
    const paths = { files: new Map(), directories: new Map() };
    validateReferenceDictionary(error, files, paths, manifest.staticAssets, {
        source: '/staticAssets',
        kind: 'static asset',
        allowMediaType: true,
        getStoragePath: getStaticAssetPath,
    });
    validateSingleReference(error, files, paths, manifest.globalTemplatePartials, {
        source: '/globalTemplatePartials',
        getStoragePath: getGlobalTemplatePartialsPath,
    });
    validateSingleReference(error, files, paths, manifest.baseTemplates, {
        source: '/baseTemplates',
        getStoragePath: getBaseTemplatesPath,
    });
    validatePages(error, files, paths, manifest.pages);

    if (error.length) {
        throw error;
    }
    return files;
}

/**
 * Validates one parsed structured content object referenced by a manifest.
 * @param {string} kind - One of `globalTemplatePartials`, `baseTemplates`, `pageMetadata`, `pagePartials`, or `pageIncludes`
 * @param {*} content - Payload already parsed from JSON; only its content-kind schema is checked
 * @param {string} [source='/content'] - JSON Pointer prefix used in failures
 * @returns {void}
 * @throws {ValidationError} When the payload violates its content-kind schema
 */
export function validateStructuredContent(kind, content, source = '/content') {
    assertNonEmptyString(kind, 'validateStructuredContent: kind');
    assertNonEmptyString(source, 'validateStructuredContent: source');

    const error = new ValidationError(`The ${ kind } content is invalid`);
    if (kind === 'globalTemplatePartials' || kind === 'pagePartials') {
        validateTemplateBundle(error, content, source, 'partial template');
    } else if (kind === 'baseTemplates') {
        validateTemplateBundle(error, content, source, 'base template');
    } else if (kind === 'pageMetadata') {
        validateJsonObject(error, content, source);
    } else if (kind === 'pageIncludes') {
        validateIncludes(error, content, source);
    } else {
        error.push(`Unknown structured content kind "${ kind }"`, source);
    }

    if (error.length) {
        throw error;
    }
}

function validateReferenceDictionary(error, files, paths, dictionary, options) {
    if (isUndefined(dictionary)) {
        return;
    }
    const { source, kind, allowMediaType = false, getStoragePath } = options;
    if (!isPlainObject(dictionary)) {
        error.push(`${ source } must be a plain object`, source);
        return;
    }

    for (const [ pathname, reference ] of Object.entries(dictionary)) {
        const itemSource = `${ source }/${ escapePointer(pathname) }`;
        if (!isCanonicalPathname(pathname, false)) {
            error.push(`${ kind } pathname must be safe and canonical`, itemSource);
            continue;
        }
        const validated = validateReference(error, reference, itemSource, allowMediaType);
        if (validated) {
            addFile(error, files, paths, getStoragePath(pathname), validated, itemSource);
        }
    }
}

function validateSingleReference(error, files, paths, reference, options) {
    if (isUndefined(reference)) {
        return;
    }
    const validated = validateReference(error, reference, options.source, false);
    if (validated) {
        addFile(error, files, paths, options.getStoragePath(), validated, options.source);
    }
}

function validatePages(error, files, paths, pages) {
    if (isUndefined(pages)) {
        return;
    }
    if (!isPlainObject(pages)) {
        error.push('/pages must be a plain object', '/pages');
        return;
    }

    for (const [ pathname, page ] of Object.entries(pages)) {
        const source = `/pages/${ escapePointer(pathname) }`;
        const hasValidPathname = isCanonicalPathname(pathname, true);
        if (!hasValidPathname) {
            error.push('Page pathname must be safe and canonical', source);
        }
        if (!isPlainObject(page)) {
            error.push('Page entry must be a plain object', source);
            continue;
        }
        rejectUnknownFields(error, page, PAGE_FIELDS, source);

        validatePageReference(error, files, paths, page.metadata, source + '/metadata', hasValidPathname, () => getPageMetadataPath(pathname));
        validatePageReference(error, files, paths, page.partials, source + '/partials', hasValidPathname, () => getPagePartialsPath(pathname));
        validatePageReference(error, files, paths, page.includes, source + '/includes', hasValidPathname, () => getPageIncludesPath(pathname));
        validatePageTemplates(error, files, paths, page.templates, pathname, source, hasValidPathname);
    }
}

function validatePageReference(error, files, paths, reference, source, hasValidPathname, getStoragePath) {
    if (isUndefined(reference)) {
        return;
    }
    const validated = validateReference(error, reference, source, false);
    if (validated && hasValidPathname) {
        addFile(error, files, paths, getStoragePath(), validated, source);
    }
}

function validatePageTemplates(error, files, paths, templates, pagePathname, pageSource, hasValidPagePathname) {
    if (isUndefined(templates)) {
        return;
    }
    const source = pageSource + '/templates';
    if (!isPlainObject(templates)) {
        error.push('Page templates must be a plain object', source);
        return;
    }

    for (const [ filename, reference ] of Object.entries(templates)) {
        const itemSource = `${ source }/${ escapePointer(filename) }`;
        const hasValidFilename = isCanonicalFilename(filename);
        if (!hasValidFilename) {
            error.push('Template filename must be safe, canonical, and unreserved', itemSource);
        }
        const validated = validateReference(error, reference, itemSource, false);
        if (validated && hasValidPagePathname && hasValidFilename) {
            const pathname = normalizePathname(`${ pagePathname }/${ filename }`);
            addFile(error, files, paths, getPageTemplatePath(pathname), validated, itemSource);
        }
    }
}

function validateReference(error, reference, source, allowMediaType) {
    if (!isPlainObject(reference)) {
        error.push('Content reference must be a plain object', source);
        return null;
    }
    rejectUnknownFields(
        error,
        reference,
        allowMediaType ? STATIC_ASSET_REFERENCE_FIELDS : REFERENCE_FIELDS,
        source,
    );

    const { objectId, size, mediaType } = reference;
    let isValid = true;
    if (!isValidHash(objectId)) {
        error.push('objectId must be a valid content address', source + '/objectId');
        isValid = false;
    }
    if (!Number.isInteger(size) || size < 0) {
        error.push('size must be a non-negative integer', source + '/size');
        isValid = false;
    }
    if (allowMediaType && !isUndefined(mediaType) && !isNonEmptyString(mediaType)) {
        error.push('mediaType must be a non-empty string when present', source + '/mediaType');
        isValid = false;
    }
    if (!isValid) {
        return null;
    }

    const file = { hash: objectId, size };
    if (allowMediaType && !isUndefined(mediaType)) {
        file.metadata = { mediaType };
    }
    return file;
}

// Looks up ancestors and descendants by key, not by scanning every earlier
// path, so a manifest at the entry limit validates in linear time.
function addFile(error, files, paths, pathname, reference, source) {
    const priorSource = paths.files.get(pathname);
    if (priorSource) {
        error.push(`Storage pathname collides with ${ priorSource }`, source);
        return;
    }

    const ancestors = ancestorDirectories(pathname);
    const fileBelow = paths.directories.get(pathname);
    const fileAbove = ancestors.find((ancestor) => paths.files.has(ancestor));
    if (fileBelow || fileAbove) {
        const existingSource = fileBelow ?? paths.files.get(fileAbove);
        error.push(`Storage pathname has a file/directory collision with ${ existingSource }`, source);
        return;
    }

    paths.files.set(pathname, source);
    for (const ancestor of ancestors) {
        if (!paths.directories.has(ancestor)) {
            paths.directories.set(ancestor, source);
        }
    }
    files.push({ pathname, ...reference });
}

// Every proper prefix of the pathname that ends just before a "/".
function ancestorDirectories(pathname) {
    const ancestors = [];
    for (let index = pathname.indexOf('/', 1); index !== -1; index = pathname.indexOf('/', index + 1)) {
        ancestors.push(pathname.slice(0, index));
    }
    return ancestors;
}

function validateTemplateBundle(error, bundle, source, label) {
    if (!Array.isArray(bundle)) {
        error.push(`${ label } bundle must be an array`, source);
        return;
    }
    const ids = new Set();
    bundle.forEach((template, index) => {
        const itemSource = `${ source }/${ index }`;
        if (!isPlainObject(template)) {
            error.push(`${ label } must be a plain object`, itemSource);
            return;
        }
        rejectUnknownFields(error, template, TEMPLATE_FIELDS, itemSource);
        if (!isNonEmptyString(template.id)) {
            error.push(`${ label } id must be a non-empty string`, itemSource + '/id');
        } else if (ids.has(template.id)) {
            error.push(`${ label } id must be unique`, itemSource + '/id');
        } else {
            ids.add(template.id);
        }
        if (!isNonEmptyString(template.source)) {
            error.push(`${ label } source must be a non-empty string`, itemSource + '/source');
        }
    });
}

function validateIncludes(error, includes, source) {
    if (!isPlainObject(includes)) {
        error.push('Includes must be a plain object', source);
        return;
    }
    for (const [ name, value ] of Object.entries(includes)) {
        if (!isString(value)) {
            error.push('Include content must be a string', `${ source }/${ escapePointer(name) }`);
        }
    }
}

function validateJsonObject(error, value, source) {
    if (!isPlainObject(value)) {
        error.push('Content must be a plain JSON object', source);
    }
}

function rejectUnknownFields(error, value, allowedFields, source) {
    for (const field of Object.keys(value)) {
        if (!allowedFields.has(field)) {
            error.push(`Unknown field "${ field }"`, `${ source }/${ escapePointer(field) }`);
        }
    }
}

function isCanonicalPathname(pathname, allowRoot) {
    return isNonEmptyString(pathname)
        && isValidPathname(pathname)
        && normalizePathname(pathname) === pathname
        && (allowRoot || pathname !== '/');
}

function isCanonicalFilename(filename) {
    return isNonEmptyString(filename)
        && !filename.includes('/')
        && isValidPathname('/' + filename)
        && normalizePathname('/' + filename) === '/' + filename
        && !RESERVED_PAGE_FILENAMES.has(filename);
}

function escapePointer(value) {
    return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}
