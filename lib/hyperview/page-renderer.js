import { AssertionError } from '../errors.js';
import { isNonEmptyString } from '../assertions.js';
import { getContentTypeForFilepath } from '../utils/http-utils.js';


/**
 * Renders Hyperview pages into final response markup.
 *
 * The request and error handlers share the same template-loading and content
 * type resolution policy. This collaborator keeps that rendering policy in one
 * place so the handlers remain thin workflow coordinators.
 */
export default class PageRenderer {

    /**
     * @type {import('./hyperview-service.js').default}
     */
    #service;

    /**
     * @param {import('./hyperview-service.js').default} service - Hyperview service used to load templates and content
     */
    constructor(service) {
        this.#service = service;
    }

    /**
     * Loads templates, renders the page body, and wraps it in the selected base template.
     * @param {Object} options
     * @param {string} options.pathname - Logical page pathname used for template lookup
     * @param {string} options.requestPathname - Original request pathname used for content-type fallback
     * @param {Object} options.page - Page data object to render
     * @param {string} options.baseTemplateId - Base template identifier
     * @param {boolean} [options.useCache=false] - Whether cached templates/content may be reused
     * @param {string} [options.templateFilename] - Explicit page template filename override
     * @param {string} [options.contentType] - Preferred content type override
     * @param {boolean} [options.includeMarkdown=false] - Whether markdown content should be loaded and exposed as `content`
     * @param {Function|null} [options.pageTemplate] - Preloaded page template function to reuse
     * @param {Function|null} [options.baseTemplate] - Preloaded base template function to reuse
     * @returns {Promise<{ hypertext: string, contentType: string }>} Rendered markup and resolved content type
     */
    async renderPage({
        pathname,
        requestPathname,
        page,
        baseTemplateId,
        useCache = false,
        templateFilename,
        contentType,
        includeMarkdown = false,
        pageTemplate,
        baseTemplate,
    }) {
        const [ resolvedPageTemplate, resolvedBaseTemplate, content ] = await Promise.all([
            pageTemplate
                ? Promise.resolve(pageTemplate)
                : this.#service.getPageTemplate(pathname, { useCache, templateFilename }),
            baseTemplate
                ? Promise.resolve(baseTemplate)
                : this.#service.getBaseTemplate(baseTemplateId, { useCache }),
            includeMarkdown
                ? this.#service.getPageMarkdown(pathname, page, { useCache })
                : Promise.resolve(null),
        ]);

        if (!resolvedPageTemplate) {
            throw new AssertionError(
                `The page template was not found (pathname:${ pathname })`
            );
        }

        if (!resolvedBaseTemplate) {
            throw new AssertionError(
                `The base template was not found (baseTemplate:${ baseTemplateId }, pathname:${ pathname })`
            );
        }

        let bodyContext = page;
        if (includeMarkdown) {
            bodyContext = Object.assign({}, page, { content });
        }

        page.body = resolvedPageTemplate(bodyContext);

        return {
            hypertext: resolvedBaseTemplate(page),
            contentType: this.#resolveContentType(contentType, baseTemplateId, requestPathname),
        };
    }

    #resolveContentType(contentType, baseTemplateId, requestPathname) {
        if (isNonEmptyString(contentType)) {
            return contentType;
        }

        // baseTemplateId (e.g., "base.html") is the primary signal for content type.
        // requestPathname is the fallback for cases where the base template name
        // doesn't carry an extension (e.g., a generic "base" template serving an
        // ".xml" request). Without the fallback, those responses would default to
        // text/html even when the caller expects a different media type.
        return getContentTypeForFilepath(baseTemplateId)
            || getContentTypeForFilepath(requestPathname)
            || 'text/html';
    }
}
