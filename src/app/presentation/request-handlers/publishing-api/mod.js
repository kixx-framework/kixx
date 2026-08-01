/**
 * Public request-handler surface of the publishing API.
 *
 * Route configuration imports handlers from here rather than from the individual
 * modules, so a handler can move between files without touching the routes.
 *
 * @module publishing-api
 */

export { putPageInclude } from './put-page-include.js';
export { putPageMetadata } from './put-page-metadata.js';
export { putStaticAsset } from './put-static-asset.js';
export { putBaseTemplate, putPageTemplate } from './put-template.js';
export { putPartials } from './put-partials.js';
