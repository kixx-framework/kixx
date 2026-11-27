// The app's lifecycle module. It runs after every plugin's.
//
// initialize() is where the app wires itself up: register a template helper
// with the HyperviewService, or look up a service a plugin registered. It
// may also export register(), start(), and stop().
//
// Keep platform code out of app/. Never import a node:* or cloudflare:*
// module here, or anything under kixx/adapters/.

export function initialize(_context) {
}
