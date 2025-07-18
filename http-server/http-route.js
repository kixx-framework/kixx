export default class HttpRoute {

    #targets = [];
    #matchPattern = null;
    #errorHandlers = [];

    constructor({ name, patternMatcher, targets, errorHandlers }) {
        this.#matchPattern = patternMatcher;
        this.#targets = targets;
        this.#errorHandlers = errorHandlers;

        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: name,
            },
        });
    }

    /**
     * Retrieve an Array of methods available on this route by iterating
     * through each of the child HttpTarget instances and getting the
     * HttpTarget:allowedMethods Array from each.
     *
     * A single, de-duplicated Array is returned.
     *
     * @return {Array}
     */
    get allowedMethods() {
        // Use a Set to ensure uniqueness (de-duplicate).
        const allowedMethods = new Set();

        for (const target of this.#targets) {
            for (const method of target.allowedMethods) {
                allowedMethods.add(method);
            }
        }

        // Return an Array.
        return Array.from(allowedMethods);
    }

    /**
     * Check the match pattern for a metch with the given URL pathname. If a
     * match is found then return the match pattern Regexp capture
     * as parameters. Otherwise return null.
     *
     * @param  {string} pathname URL pathname
     * @return {object|null}
     */
    matchPathname(pathname) {
        const res = this.#matchPattern(pathname);

        if (res) {
            return res.params;
        }

        return null;
    }

    /**
     * Find the matching HttpTarget for the given HTTP request. If a match is
     * found then return the matching HttpTarget. Otherwise, return null.
     *
     * A match is found by iterating through each child HttpTarget instances and
     * calling HttpTarget:isMethodAllowed().
     *
     * @param  {HttpRequest} request
     * @return {HttpTarget|null}
     */
    findTargetForRequest(request) {
        const { method } = request;

        for (const target of this.#targets) {
            if (target.isMethodAllowed(method)) {
                return target;
            }
        }

        return null;
    }

    /**
     * Handle an error on this Route. It will invoke each handler in the
     * error handlers list until one returns a truthy value.
     *
     * Will only be called if the target is not found. If the target *is* found
     * then the target error handler chain will be invoked instead.
     *
     * Error handlers are expected to execute synchronously.
     *
     * @param  {ApplicationContext} context
     * @param  {HttpRequest} request
     * @param  {HttpResponse} response
     * @param  {Error} error
     * @return {HttpResponse}
     */
    handleError(context, request, response, error) {
        for (const func of this.#errorHandlers) {
            const newResponse = func(context, request, response, error);

            if (newResponse) {
                return newResponse;
            }
        }

        return false;
    }
}
