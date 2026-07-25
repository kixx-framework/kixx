import { requirePermission } from '../../middleware/require-permission.js';
import { getWildcardPathname, splitIncludeFilepath } from './route-params.js';


// The publishing API's 403 wire contract predates requirePermission() and is
// preserved verbatim here rather than falling back to ForbiddenError's class
// defaults, so existing publishing token clients keep seeing the same code
// and message.
const PUBLISHING_FORBIDDEN_OPTIONS = {
    code: 'PublishingApiTokenForbidden',
    message: 'The publishing API token is not authorized for this request.',
};


// Template writes are gated by a single coarse-grained capability shared by
// all three template kinds (base/page/partial) — the decision does not
// depend on kind or filepath.
export const requireTemplatePermission = requirePermission({
    action: 'urn:kixx:publishing:template:put',
    resource: 'urn:kixx:publishing:template',
    ...PUBLISHING_FORBIDDEN_OPTIONS,
});

// Page metadata writes are scoped per pathname. The resolver shares
// getWildcardPathname() with the request handler so the URN that gets
// authorized always describes the pathname the handler writes.
export const requirePageMetadataPermission = requirePermission({
    action: 'urn:kixx:publishing:page-metadata:put',
    resource(_context, request) {
        const pathname = getWildcardPathname(request, 'pathname');
        return `urn:kixx:publishing:page-metadata:${ pathname }`;
    },
    ...PUBLISHING_FORBIDDEN_OPTIONS,
});

// Include writes are scoped per filepath. The resolver shares
// splitIncludeFilepath() with the request handler so the URN that gets
// authorized always describes the filepath the handler writes.
export const requireIncludePermission = requirePermission({
    action: 'urn:kixx:publishing:include:put',
    resource(_context, request) {
        const { filepath } = splitIncludeFilepath(request, 'filepath');
        return `urn:kixx:publishing:include:${ filepath }`;
    },
    ...PUBLISHING_FORBIDDEN_OPTIONS,
});

// Asset writes are gated by a single coarse-grained capability — the
// decision does not depend on filepath.
export const requireAssetPermission = requirePermission({
    action: 'urn:kixx:publishing:asset:put',
    resource: 'urn:kixx:publishing:asset',
    ...PUBLISHING_FORBIDDEN_OPTIONS,
});
