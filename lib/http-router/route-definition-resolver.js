import { AssertionError } from '../errors.js';
import HttpTarget from './http-target.js';


/**
 * Resolves tuple-based route definitions into executable middleware and handlers.
 *
 * Route specs allow middleware, request handlers, and error handlers to be
 * declared either as direct functions or as `[ name, options ]` tuples that
 * reference factories registered in the application context. This resolver owns
 * that hydration step so `HttpRoute` can stay focused on runtime matching and
 * error handling.
 */
export default class RouteDefinitionResolver {

    /**
     * @param {Object} options
     * @param {Map<string, Function>} options.middleware - Middleware registry keyed by name
     * @param {Map<string, Function>} options.requestHandlers - Request handler registry keyed by name
     * @param {Map<string, Function>} options.errorHandlers - Error handler registry keyed by name
     */
    constructor({ middleware, requestHandlers, errorHandlers }) {
        this.middleware = middleware;
        this.requestHandlers = requestHandlers;
        this.errorHandlers = errorHandlers;
    }

    /**
     * Resolves a route specification into executable route parts.
     * @param {Object} routeSpec - Route specification to resolve
     * @returns {{name: string, pattern: string, targets: Array<HttpTarget>, errorHandlers: Array<Function>}}
     */
    resolveRoute(routeSpec) {
        const { name, pattern } = routeSpec;

        const inboundMiddleware = this.#resolveDefinitions({
            definitions: routeSpec.inboundMiddleware,
            registry: this.middleware,
            unknownMessage: (definitionName) => `Unknown inbound middleware: ${ definitionName } (in route: ${ name })`,
        });
        const outboundMiddleware = this.#resolveDefinitions({
            definitions: routeSpec.outboundMiddleware,
            registry: this.middleware,
            unknownMessage: (definitionName) => `Unknown outbound middleware: ${ definitionName } (in route: ${ name })`,
        });
        const routeErrorHandlers = this.#resolveDefinitions({
            definitions: routeSpec.errorHandlers,
            registry: this.errorHandlers,
            unknownMessage: (definitionName) => `Unknown error handler: ${ definitionName } (in route: ${ name })`,
        });

        const resolvedRouteSpec = {
            name,
            pattern,
            inboundMiddleware,
            outboundMiddleware,
            errorHandlers: routeErrorHandlers,
        };

        const targets = routeSpec.targets.map((targetSpec) => {
            return this.#resolveTarget(targetSpec, resolvedRouteSpec);
        });

        return {
            name,
            pattern,
            targets,
            errorHandlers: routeErrorHandlers,
        };
    }

    #resolveTarget(targetSpec, routeSpec) {
        const handlers = this.#resolveDefinitions({
            definitions: targetSpec.handlers,
            registry: this.requestHandlers,
            unknownMessage: (definitionName) => `Unknown request handler: ${ definitionName } (in target: ${ targetSpec.name })`,
        });
        const targetErrorHandlers = this.#resolveDefinitions({
            definitions: targetSpec.errorHandlers,
            registry: this.errorHandlers,
            unknownMessage: (definitionName) => `Unknown error handler: ${ definitionName } (in target: ${ targetSpec.name })`,
        });

        return HttpTarget.fromSpecification(routeSpec, {
            name: targetSpec.name,
            methods: targetSpec.methods,
            tags: targetSpec.tags,
            handlers,
            errorHandlers: targetErrorHandlers,
        });
    }

    #resolveDefinitions({ definitions, registry, unknownMessage }) {
        const resolvedDefinitions = [];

        for (let i = 0; i < definitions.length; i += 1) {
            const definition = definitions[i];

            if (Array.isArray(definition)) {
                const [ definitionName, options ] = definition;

                if (!registry.has(definitionName)) {
                    throw new AssertionError(unknownMessage(definitionName));
                }

                const factory = registry.get(definitionName);
                resolvedDefinitions.push(factory(options || {}));
            } else {
                resolvedDefinitions.push(definition);
            }
        }

        return resolvedDefinitions;
    }
}
