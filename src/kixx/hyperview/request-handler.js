export default function HyperviewRequestHandler() {

    return async function hyperviewRequestHandler(context, request, response) {
        const page = await hyperview.getPage(context, {
            url: request.url,
            pathname,
            props: response.props,
            pageTemplateId,
            baseTemplateId,
        });

        if (!page) {
            throw new NotFoundError(`No page found for pathname "${ pathname }"`);
        }

        if (isJsonRequest(request)) {
            // The optional JSON response is for development and debugging.
            return response.respondWithJSON(response.status, page.context, { whiteSpace: 4 });
        }

        let hypertext;

        const digest = await page.getDigest({
            includeProps: includePropsInDigest,
            propsHashFunction,
        });

        if (usePageCache) {

            hypertext = await pageCache.get(context, request.url, digest, {
                ttlSeconds: pageCacheReadTtlSeconds,
            });
            if (hypertext) {
                return response.respondWithUtf8(response.status, hypertext, {
                    contentType: responseContentType,
                });
            }
        }

        hypertext = await page.renderHypertext();

        if (usePageCache) {
            await pageCache.set(context, request.url, digest, hypertext, {
                ttlSeconds: pageCacheExpirationSeconds,
            });
        }

        return response.respondWithUtf8(response.status, hypertext, {
            contentType: responseContentType,
        });
    };
}
