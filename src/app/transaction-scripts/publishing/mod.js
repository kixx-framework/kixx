import { AssertionError } from '../../../../kixx/errors/mod.js';
import { isUndefined } from '../../../../kixx/assertions/mod.js';


export async function statResource(context, type, pathname) {
    const store = context.getService('ContentAddressableStore');

    // Reads resolve through a snapshot rather than the store so they are
    // pinned to a single immutable content index for this request.
    const content = await store.openSnapshot(context);

    // When provided, we assume the pathname has been validated by the
    // caller before reaching this point.
    //
    // If required, the pathname validity is asserted by the snapshot,
    // so we don't assert it here.
    let result;
    switch (type) {
        case 'template_partials':
            result = await content.statTemplatePartials();
            break;
        case 'base_templates':
            result = await content.statBaseTemplates();
            break;
        case 'page_metadata':
            result = await content.statPageMetadata(pathname);
            break;
        case 'page_partials':
            result = await content.statPagePartials(pathname);
            break;
        case 'page_includes':
            result = await content.statPageIncludes(pathname);
            break;
        case 'page_template':
            result = await content.statPageTemplate(pathname);
            break;
        default:
            throw new AssertionError(`Invalid resource type "${ type }" passed to statResource()`);
    }

    return result;
}

export async function putResource(context, type, pathname, payload, etag) {
    const store = context.getService('ContentAddressableStore');

    // When provided, we assume the pathname has been validated by the
    // caller before reaching this point.
    //
    // If required, the pathname validity is asserted by the
    // Content Addressable Store, so we don't assert it here.
    let result;
    switch (type) {
        case 'template_partials':
            result = await store.putTemplatePartials(context, payload, etag);
            break;
        case 'base_templates':
            result = await store.putBaseTemplates(context, payload, etag);
            break;
        case 'page_metadata':
            result = await store.putPageMetadata(context, pathname, payload, etag);
            break;
        case 'page_partials':
            result = await store.putPagePartials(context, pathname, payload, etag);
            break;
        case 'page_includes':
            result = await store.putPageIncludes(context, pathname, payload, etag);
            break;
        case 'page_template':
            result = await store.putPageTemplate(context, pathname, payload, etag);
            break;
        default:
            throw new AssertionError(`Invalid resource type "${ type }" passed to putResource()`);
    }

    return result;
}

export async function commitChanges(context, buildId, manifest) {
    if (isUndefined(buildId)) {
        buildId = context.runtime.build.id;
    }

    const store = context.getService('ContentAddressableStore');
    return await store.commitChanges(context, buildId, manifest);
}
