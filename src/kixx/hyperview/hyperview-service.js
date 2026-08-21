export default class HyperviewService {
    async respondWithHypertext(context, request, response, options) {
        options = options ?? {};

        // Each caller may override the constructor-level default for its own call.
        const usePageCache = options.usePageCache ?? this.#usePageCache;
        const pageCacheReadTtlSeconds = options.pageCacheReadTtlSeconds ?? this.#pageCacheReadTtlSeconds;
        const pageCacheExpirationSeconds = options.pageCacheExpirationSeconds ?? this.#pageCacheExpirationSeconds;

        // If page cache is turned on, then we want to include props in the cache key
        // by default. Otherwise we could cache and serve a page intended for a
        // specific user to a different user without explicitly
        // overriding includePropsInCacheKey.
        let includePropsInCacheKey = false;
        if (usePageCache) {
            if (isUndefined(options.includePropsInCacheKey)) {
                includePropsInCacheKey = true;
            } else {
                includePropsInCacheKey = options.includePropsInCacheKey;
            }
        }

        const allowJsonResponse = options.allowJsonResponse ?? this.#allowJsonResponse;

        // Gate the ".json" extension on allowJsonResponse here, because this flag also
        // decides whether the extension is stripped from the pathname. Ungated, a
        // ".json" request would resolve the page at the extensionless pathname
        // and render it as HTML whenever JSON responses are disabled, exposing
        // every page under a second, non-canonical URL instead of
        // reporting it as not found.
        const isJsonPathRequest = allowJsonResponse && request.url.pathname.toLowerCase().endsWith('.json');

        let pathname;
        if (isNonEmptyString(options.pathname)) {
            pathname = options.pathname;
        } else {
            let requestPathname = request.url.pathname;
            if (isJsonPathRequest) {
                // Slicing by length rather than matching on ".json" literally, so
                // this strips whichever case of the extension isJsonPathRequest matched.
                requestPathname = requestPathname.slice(0, -'.json'.length);
                // "index" names a directory page at every depth, not a page called
                // "index", so drop the segment and let normalizePathname() fold the
                // trailing slash. Matching only "/index" would leave the ".json"
                // affordance broken for every directory page below the root.
                if (requestPathname.endsWith('/index')) {
                    requestPathname = requestPathname.slice(0, -'index'.length);
                }
            }
            pathname = normalizePathname(requestPathname);
        }

        this.#assertCanonicalIdentifier(
            pathname,
            'HyperviewService#respondWithHypertext: pathname',
        );

        // We need to assert these identifiers are correct and safe here, because they
        // may not have been checked prior to reaching this routine.
        if (options.partial) {
            this.#assertCanonicalIdentifier(
                options.partial,
                'HyperviewService#respondWithHypertext: options.partial',
            );
        } else if (!options.skipBaseRender) {
            this.#assertCanonicalIdentifier(
                options.baseTemplateId,
                'HyperviewService#respondWithHypertext options.baseTemplateId',
            );
        }

        const { url } = request;

        // A render reads all of its content, including cache-key inputs, through
        // exactly one request-scoped snapshot.
        const content = await this.#contentStore.openSnapshot(context);

        const page = await getPage(content, url, pathname, response.props);

        if (!page) {
            throw new NotFoundError(`No page found for URL "${ url.href }"`, {
                url: url.href,
                pathname,
            });
        }

        // Serve JSON only when the deployment allows it and the client asked for
        // it, by the ".json" path extension.
        if (isJsonPathRequest) {
            // The optional JSON response is intended for development and debugging.
            return response.respondWithJSON(
                response.status,
                page.getPageContext(),
                { whiteSpace: 4 },
            );
        }

        let pageCacheKey;
        let hypertext;

        // Disabling the rendered-page cache also skips its storage stats and
        // hashing; compiled-template cache validation remains in the loaders.
        if (usePageCache) {
            const partials = content.statGlobalTemplatePartials();
            let hash = await hashValue(`${ page.hash }#${ partials?.hash ?? '' }`);

            // Optionally add the hash of the canonicalized props object.
            if (includePropsInCacheKey) {
                let propsHash;
                if (isFunction(options.propsHashFunction)) {
                    propsHash = await options.propsHashFunction(
                        page.pathname,
                        page.getPageContext(),
                        response.props,
                    );
                } else {
                    propsHash = await hashValue(response.props);
                }
                hash = await hashValue(`${ hash }#${ propsHash }`);
            }

            // If the caller does not provide a custom cache key, we use the URL
            // origin + pathname + query params as the default.
            const pageCacheIdentity = isNonEmptyString(options.cacheKey)
                ? options.cacheKey
                : (url.origin + url.pathname + url.search);

            let renderModeIdentity;

            if (options.partial) {
                renderModeIdentity = `PARTIAL#${ options.partial }`;
            } else if (options.skipBaseRender) {
                renderModeIdentity = 'PAGE_TEMPLATE_ONLY';
            } else {
                const baseTemplates = content.statBaseTemplates();
                hash = await hashValue(`${ hash }#${ baseTemplates?.hash ?? '' }`);
                renderModeIdentity = `FULL_PAGE#${ options.baseTemplateId }`;
            }

            // The logical identity can be arbitrarily large (full URL, query string,
            // custom cache key) and may contain sensitive query-string values, so it
            // is never used as the KV key or logged directly. Hashing it into a short,
            // opaque, fixed-length key also keeps every key within the portable
            // 512-byte KV key limit regardless of the input size.
            const logicalCacheIdentity = await hashValue(`${ pageCacheIdentity }#${ renderModeIdentity }#${ hash }`);
            pageCacheKey = `hyperview_page_cache#${ logicalCacheIdentity }`;

            hypertext = await this.#kvStore.get(context, pageCacheKey, {
                type: 'text',
                cacheTtl: pageCacheReadTtlSeconds,
            });
            if (hypertext) {
                this.#logger.debug('cached page hit', { url: url.href, pathname, key: pageCacheKey });
                return response.respondWithUtf8(response.status, hypertext, options.responseOptions);
            }
            this.#logger.info('cached page miss', { url: url.href, pathname, key: pageCacheKey });
        }

        if (options.partial) {
            // Render a partial template only. This is common for making dynamic page
            // updates from the browser with fetch().
            this.#logger.debug('render partial for page', { pathname, url: url.href, partial: options.partial });

            const globalPartials = await this.#loadGlobalPartials(content);
            const pagePartials = page.getPartials();
            const template = pagePartials.get(options.partial);
            assertFunction(template, `Partial template "${ options.partial }" does not exist in pages/${ pathname }`);

            hypertext = template(page.getPageContext(), layerPartials(pagePartials, globalPartials));
            assertNonEmptyString(
                hypertext,
                `HyperviewService rendered empty hypertext for the partial "${ options.partial }" render of page "${ pathname }"`,
            );

            if (usePageCache) {
                await this.#kvStore.put(context, pageCacheKey, hypertext, {
                    type: 'text',
                    ttlSeconds: pageCacheExpirationSeconds,
                });
            }

            return response.respondWithUtf8(response.status, hypertext, options.responseOptions);
        }

        if (options.skipBaseRender) {
            // Render the page body, without wrapping in the base template. This is common
            // for page transitions triggered from the browser with fetch().
            this.#logger.debug('skip base template render for page', { url: url.href, pathname });

            const template = page.getTemplate();
            const pagePartials = page.getPartials();
            const globalPartials = await this.#loadGlobalPartials(content);

            hypertext = template(page.getPageContext(), layerPartials(pagePartials, globalPartials));
            assertNonEmptyString(
                hypertext,
                `HyperviewService rendered empty hypertext for page template render of page "${ pathname }"`,
            );

            if (usePageCache) {
                await this.#kvStore.put(context, pageCacheKey, hypertext, {
                    type: 'text',
                    ttlSeconds: pageCacheExpirationSeconds,
                });
            }

            return response.respondWithUtf8(response.status, hypertext, options.responseOptions);
        }

        const baseTemplate = await this.#loadBaseTemplate(content, options.baseTemplateId);

        assertFunction(baseTemplate, `Base template "${ options.baseTemplateId }" does not exist`);

        const pageContext = page.getPageContext();
        const pageTemplate = page.getTemplate();
        const globalPartials = await this.#loadGlobalPartials(content);
        const pagePartials = page.getPartials();
        const partials = layerPartials(pagePartials, globalPartials);

        pageContext.body = pageTemplate(pageContext, partials);
        hypertext = baseTemplate(pageContext, partials);
        assertNonEmptyString(
            hypertext,
            `HyperviewService rendered empty hypertext for full page render of page "${ pathname }"`,
        );

        if (usePageCache) {
            await this.#kvStore.put(context, pageCacheKey, hypertext, {
                type: 'text',
                ttlSeconds: pageCacheExpirationSeconds,
            });
        }

        return response.respondWithUtf8(response.status, hypertext, options.responseOptions);
    }
}
