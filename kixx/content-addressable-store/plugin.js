// Core registration: pure framework logic with no platform variant of its own.
//
// ContentAddressableStore is the same on every deploy target — all of the
// platform variation lives one layer down, behind the ContentStore port. This
// module exists only to register the framework service and bind it to whichever
// adapter the running platform registered under 'ContentStore'.

import ContentAddressableStore from './content-addressable-store.js';
import { readWorkingTreeSwitch } from './working-tree-switch.js';


/**
 * Registers the store. First it checks `CONTENT_STORE.workingTree`, on every
 * platform and before any store opens, so a malformed value, or `true`
 * outside development, fails boot. In development the key is only read here:
 * the Node.js server acts on it, and a Cloudflare Worker, which has no
 * working tree, ignores it and serves the published Release.
 *
 * @param {Object} context - The application context
 * @returns {void}
 * @throws {OperationalError} When `CONTENT_STORE.workingTree` is malformed, or `true` outside development
 */
export function register(context) {
    readWorkingTreeSwitch(context.config);

    context.registerService('ContentAddressableStore', new ContentAddressableStore());
}

export function initialize(context) {
    const { logger } = context;
    const contentStore = context.getService('ContentStore');
    const store = context.getService('ContentAddressableStore');
    store.initialize({ logger, contentStore });
}
