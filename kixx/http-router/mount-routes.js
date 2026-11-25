import {
    AssertionError,
    assertNonEmptyString,
    isPlainObject,
    isUndefined,
} from '../assertions/mod.js';


// The lists a routes module may put on its mount, beside `routes`.
const MOUNT_LIST_KEYS = [ 'inboundMiddleware', 'outboundMiddleware', 'errorHandlers' ];


/**
 * Shapes the default export of a plugin's routes module into route
 * specifications a virtual host can hold. Generated route registries call it
 * once for each routes module a plugin manifest lists.
 *
 * Without a mount, the module must export an Array of route specifications,
 * which is returned as it is.
 *
 * With a mount, the module's routes are nested under one route whose pattern
 * is the mount, so each child's pattern is appended to it and each child's name
 * is joined to the mount's name. The module may export an Array of route
 * specifications, or an Object holding that Array as `routes` beside any of
 * `inboundMiddleware`, `outboundMiddleware`, and `errorHandlers`, which then
 * apply to every route under the mount.
 *
 * This function only shapes. Patterns, middleware, and targets are validated
 * when the router is built. It never mutates the module's export.
 *
 * @param {Object} options
 * @param {string} options.plugin - Name of the plugin that owns the routes module, for error messages
 * @param {string} options.module - Path of the routes module as its manifest lists it, for error messages
 * @param {string} [options.mount] - Pathname pattern to nest the routes under
 * @param {string} [options.name] - Name of the mounted route; used only with a mount
 * @param {Array<Object>|Object} options.routes - The routes module's default export
 * @returns {Array<Object>} Route specifications to spread into a virtual host's routes
 * @throws {AssertionError} When the default export doesn't have one of the shapes above
 */
export function mountRoutes(options) {
    const {
        plugin,
        module,
        mount,
        name,
        routes,
    } = options ?? {};

    assertNonEmptyString(plugin, 'options.plugin must be a non-empty string');
    assertNonEmptyString(module, 'options.module must be a non-empty string');

    const subject = `plugin "${ plugin }" routes module ${ module }`;

    if (isUndefined(mount)) {
        if (!Array.isArray(routes)) {
            throw new AssertionError(`${ subject } must export default an Array of route specifications`);
        }

        return routes;
    }

    if (Array.isArray(routes)) {
        return [ { pattern: mount, name, routes } ];
    }

    if (!isPlainObject(routes)) {
        throw new AssertionError(
            `${ subject } must export default an Array of route specifications, or an Object with a routes Array`,
        );
    }

    // A pattern, name, or targets list on the export would be dropped without
    // a word, since the mount supplies the route's own. Reject them instead.
    for (const key of Object.keys(routes)) {
        if (key !== 'routes' && !MOUNT_LIST_KEYS.includes(key)) {
            throw new AssertionError(`${ subject } default export has an unexpected key "${ key }"`);
        }
    }

    if (!Array.isArray(routes.routes)) {
        throw new AssertionError(`${ subject } default export must have a routes Array`);
    }

    const mounted = { pattern: mount, name, routes: routes.routes };

    for (const key of MOUNT_LIST_KEYS) {
        if (!isUndefined(routes[key])) {
            mounted[key] = routes[key];
        }
    }

    return [ mounted ];
}
