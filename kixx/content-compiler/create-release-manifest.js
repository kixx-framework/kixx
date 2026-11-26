import { assert, isUndefined } from '../assertions/mod.js';
import { normalizePathname } from '../content-addressable-store/content-layout.js';
import { basename, dirname } from './posix-path.js';

/**
 * @typedef {import('./compile-content.js').ContentObject} ContentObject
 */


/**
 * Builds the Release manifest that names every content object of a
 * compilation by its id and size.
 *
 * The manifest's shape is the content contract's. Changing what this returns
 * for the same objects changes the contract.
 *
 * @param {ContentObject[]} objects - A compilation's content objects
 * @returns {Object} Release manifest
 * @throws {AssertionError} When an object has a type the manifest has no place for
 */
export function createReleaseManifest(objects) {
    const manifest = {
        staticAssets: {},
        pages: {},
    };

    for (const object of objects) {
        const reference = createReference(object);

        switch (object.type) {
            case 'StaticAsset':
                manifest.staticAssets[normalizePathname(object.pathname)] = reference;
                break;
            case 'GlobalTemplatePartials':
                manifest.globalTemplatePartials = reference;
                break;
            case 'BaseTemplates':
                manifest.baseTemplates = reference;
                break;
            case 'PageMetadata':
                getPage(manifest, object.pathname).metadata = reference;
                break;
            case 'PagePartials':
                getPage(manifest, object.pathname).partials = reference;
                break;
            case 'PageIncludes':
                getPage(manifest, object.pathname).includes = reference;
                break;
            case 'PageTemplate': {
                // A page template's pathname is its page's pathname plus
                // the template's filename.
                const page = getPage(manifest, dirname(object.pathname));
                page.templates ??= {};
                page.templates[basename(object.pathname)] = reference;
                break;
            }
            default:
                assert(false, `createReleaseManifest: unsupported content object type "${ object.type }"`);
        }
    }

    return manifest;
}

function createReference(object) {
    const reference = {
        objectId: object.hash,
        size: object.size,
    };

    if (object.type === 'StaticAsset' && !isUndefined(object.mediaType)) {
        reference.mediaType = object.mediaType;
    }

    return reference;
}

function getPage(manifest, pathname) {
    const normalized = normalizePathname(pathname);
    manifest.pages[normalized] ??= {};
    return manifest.pages[normalized];
}
