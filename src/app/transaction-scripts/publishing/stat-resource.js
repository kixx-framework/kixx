import { AssertionError } from '../../../../kixx/errors/mod.js';


export async function statResource(context, type, pathname) {
    const store = context.getService('ContentAddressableStore');

    // When provided, we assume the pathname has been validated by the
    // caller before reaching this point.
    //
    // If required, the pathname validity is asserted by the
    // Content Addressable Store, so we don't assert it here.
    let result;
    switch (type) {
        case 'template_partials':
            result = await store.statTemplatePartials(context);
            break;
        case 'base_templates':
            result = await store.statBaseTemplates(context);
            break;
        case 'page_metadata':
            result = await store.statPageMetadata(context, pathname);
            break;
        case 'page_partials':
            result = await store.statPagePartials(context, pathname);
            break;
        case 'page_includes':
            result = await store.statPageIncludes(context, pathname);
            break;
        case 'page_template':
            result = await store.statPageTemplate(context, pathname);
            break;
        default:
            throw new AssertionError(`Invalid resource type "${ type }" passed to statResource()`);
    }

    return result;
}
