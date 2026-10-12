// General plugin: pure framework logic with no platform variant of its own.
//
// ContentAddressableStore is the same on every deploy target — all of the
// platform variation lives one layer down, behind the ContentStore port. This
// plugin exists only to register the framework service and bind it to whichever
// adapter the running platform's plugin registered under 'ContentStore'.

import ContentAddressableStore from '../../kixx/content-addressable-store/content-addressable-store.js';


export function register(context) {
    context.registerService('ContentAddressableStore', new ContentAddressableStore());
}

export function initialize(context) {
    const { logger } = context;
    const contentStore = context.getService('ContentStore');
    const store = context.getService('ContentAddressableStore');
    store.initialize({ logger, contentStore });
}
