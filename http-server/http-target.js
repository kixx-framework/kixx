export default class HttpTarget {

    #middleware = [];
    #errorHandlers = [];

    constructor({ name, allowedMethods, middleware, errorHandlers }) {
        this.#middleware = middleware;
        this.#errorHandlers = errorHandlers;

        Object.defineProperties(this, {
            name: {
                enumerable: true,
                value: name,
            },
            allowedMethods: {
                enumerable: true,
                // Make a copy of the original Array before freezing it.
                value: Object.freeze(allowedMethods.slice()),
            },
        });
    }

    /**
     * Is this HTTP method in the allowed methods list for this target?
     * @param  {string} method HTTP method name
     * @return {Boolean}
     */
    isMethodAllowed(method) {
        return this.allowedMethods.includes(method);
    }

    /**
     * Invoke this target with the HttpRequest and HttpResponse. There is a
     * short circuit callback which can be used by middleware functions to
     * exit the middleware loop early.
     *
     * Middleware function are cast to asynchonous execution using await.
     *
     * @param  {HttpRequest} request
     * @param  {HttpResponse} response
     * @return {HttpResponse}
     */
    async invokeMiddleware(context, request, response) {
        let newResponse;
        let done = false;

        function skip() {
            done = true;
        }

        for (const func of this.#middleware) {
            // Middleware needs to be run in serial, so we use await in a loop
            // eslint-disable-next-line no-await-in-loop
            newResponse = await func(context, request, response, skip);

            // If the short circuit callback was called then stop
            // here and return the response.
            if (done) {
                return newResponse;
            }
        }

        return newResponse;
    }

    /**
     * Handle an error on this target. It will invoke each handler in the
     * error handlers list until one returns a truthy value.
     *
     * Error handlers are expected to execute synchronously.
     *
     * @param  {ApplicationContext} context
     * @param  {HttpRequest} request
     * @param  {HttpResponse} response
     * @param  {Error} error
     * @return {HttpResponse|boolean}
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
