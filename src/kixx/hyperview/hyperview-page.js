import deepMerge from '../utils/deep-merge.js';
import {
    isFunction,
    isUndefined,
    isObjectNotNull,
    isNonEmptyString,
} from '../assertions/mod.js';

/**
 * One page's compiled templates and its fully assembled template context.
 *
 * The context is assembled once, in the constructor, and is the whole point of
 * the class: a render must not compose a page from data that arrives at
 * different times, so everything a template can see is resolved before any
 * template runs.
 *
 * ## Merge precedence
 * Later sources override earlier ones:
 *
 * 1. Page metadata, from the broadest ancestor directory down to the leaf page.
 *    This is what makes a value published at `/blog/page.json` a default for
 *    everything beneath it.
 * 2. The page's includes, exposed as `includes`.
 * 3. The runtime response props supplied by request handlers.
 *
 * Metadata and props are deep-copied before merging, so nothing here can reach
 * back and mutate a caller's data or a cached content object.
 *
 * ## Metadata mini templates
 * `page.title` and `page.description` may be published as `{ template }` objects
 * rather than strings. Those compile during the merge and are then rendered
 * against the merged context, so a title can interpolate values the page data
 * and response props supplied. They are replaced in place, so a template always
 * sees a plain string.
 *
 * ## Mutation
 * `context` is a live object, not a snapshot. A full-page render assigns the
 * rendered page body to `context.body` before running the base template.
 * @see HyperviewService in ./hyperview-service.js for how a page is loaded and rendered
 */
export default class HyperviewPage {

    #createMiniTemplate;

    /**
     * @param {Object} spec
     * @param {URL} spec.url - Request URL, used for the canonical URL and href defaults
     * @param {string} spec.pathname - Canonical page pathname, used as the page identity and in template error messages
     * @param {Object} spec.responseProps - Runtime values merged last, overriding all published page data
     * @param {Array<Object>} spec.pageDataSources - Parsed page metadata ordered from the broadest ancestor to the leaf
     * @param {function(Object, Map): string} spec.template - Compiled page template
     * @param {Map<string, Function>} spec.partials - Compiled page-local partials, layered over the global partials at render time
     * @param {Object} spec.includes - Published include fragments keyed by include name
     * @param {string} spec.hash - Content hash covering every file this page was assembled from
     * @param {function(string, string): function(Object): string} spec.createMiniTemplate - Compiles a metadata field which cannot resolve partials
     */
    constructor(spec) {
        const {
            url,
            pathname,
            responseProps,
            pageDataSources,
            template,
            partials,
            includes,
            hash,
            createMiniTemplate,
        } = spec;

        this.#createMiniTemplate = createMiniTemplate;

        this.url = url;
        this.pathname = pathname;
        this.template = template;
        this.partials = partials;
        this.hash = hash;

        this.context = this.#formatPageContext(this.#mergeSources(
            pageDataSources,
            includes,
            responseProps,
        ));
    }

    #mergeSources(originalSources, includes, responseProps) {
        const pageContext = {};

        // The sources belong to content objects which may be shared across
        // requests, so clone before anything downstream can mutate them.
        const sources = structuredClone(originalSources);

        // Merge the pages together, with the more specific page data objects overriding
        // their parents. For the merge to work correctly, sources must be sorted
        // from grandparent -> grandchild
        for (const json of sources) {
            deepMerge(pageContext, json);
        }

        pageContext.includes = includes;

        // Clone the response.props so we don't mutate the nested data structures
        // as part of the page context hydration process.
        deepMerge(pageContext, structuredClone(responseProps));

        // Compile the title and description templates here, but do not render
        // them: they interpolate the merged context, which is not finished until
        // #formatPageContext() has filled in the URL-derived defaults. Storing the
        // compiled function in the field is what defers the render to that step.
        if (isNonEmptyString(pageContext.page?.title?.template)) {
            pageContext.page.title = this.#createMiniTemplate(
                `${ this.pathname }/page.title`,
                pageContext.page.title.template,
            );
        }
        if (isNonEmptyString(pageContext.page?.description?.template)) {
            pageContext.page.description = this.#createMiniTemplate(
                `${ this.pathname }/page.description`,
                pageContext.page.description.template,
            );
        }

        return pageContext;
    }

    // Fills in the context values derived from the request rather than published
    // with the page. Every default is applied only when the merged sources left
    // the field undefined, so page data and response props always win.
    #formatPageContext(pageContext) {
        if (isUndefined(pageContext.pathname)) {
            pageContext.pathname = this.pathname;
        }
        if (isUndefined(pageContext.url_pathname)) {
            pageContext.url_pathname = this.url.pathname;
        }

        if (!isObjectNotNull(pageContext.page)) {
            pageContext.page = {};
        }

        const { page } = pageContext;

        // Set canonical URL from request URL if not already defined in page data;
        // excludes query string and hash to provide a stable reference.
        if (isUndefined(page.canonical_url)) {
            page.canonical_url = `${ this.url.protocol }//${ this.url.host }${ this.url.pathname }`;
        }
        // The href records the fully qualified URL.
        if (isUndefined(page.href)) {
            page.href = this.url.href;
        }

        // Render the deferred metadata templates now that the context is complete,
        // replacing each compiled function with its string so a template never sees
        // a function in these fields.
        if (isFunction(page.title)) {
            page.title = page.title(pageContext);
        }
        if (isFunction(page.description)) {
            page.description = page.description(pageContext);
        }

        // Create the Open Graph object if it does not yet exist.
        if (!isObjectNotNull(page.open_graph)) {
            page.open_graph = {};
        }

        const { open_graph } = page;

        // Let existing open_graph values override the page values

        if (isUndefined(open_graph.url)) {
            open_graph.url = page.canonical_url;
        }
        if (isUndefined(open_graph.type)) {
            open_graph.type = 'website';
        }
        if (isUndefined(open_graph.title)) {
            open_graph.title = page.title;
        }
        if (isUndefined(open_graph.description)) {
            open_graph.description = page.description;
        }
        if (isUndefined(open_graph.locale)) {
            open_graph.locale = page.locale;
        }

        return pageContext;
    }
}
