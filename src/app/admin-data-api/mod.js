import ResourceRegistry from './resource-registry.js';
import filesResource from './resources/files.js';


/**
 * Collections exposed through the Administrative Data API. A Collection that
 * is not listed here cannot be reached, granted, or discovered. Adding a
 * registration exposes only the operations it declares.
 * @type {ResourceRegistry}
 */
export const adminDataResources = new ResourceRegistry([
    filesResource,
]);
