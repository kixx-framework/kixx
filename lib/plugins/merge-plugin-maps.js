import { assert, isMap } from '../kixx/assertions/mod.js';


/**
 * Merges a general plugin map with a platform plugin map, letting platform
 * plugins override general plugins registered under the same key.
 * @param {Map} generalPlugins - The cross-platform plugin map.
 * @param {Map} platformPlugins - The platform-specific plugin map.
 * @returns {Map} A new Map with platform entries taking precedence.
 * @throws {AssertionError} When either argument is not a Map.
 */
export function mergePluginMaps(generalPlugins, platformPlugins) {
    assert(isMap(generalPlugins), 'mergePluginMaps() requires generalPlugins to be a Map');
    assert(isMap(platformPlugins), 'mergePluginMaps() requires platformPlugins to be a Map');

    return new Map([ ...generalPlugins, ...platformPlugins ]);
}
