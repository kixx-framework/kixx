// General plugin: pure framework logic with no platform variant of its own.

import ContentAddressableStore from '../../kixx/content-addressable-store/content-addressable-store.js';


export function register(context) {
    context.registerService('ContentAddressableStore', new ContentAddressableStore());
}

export function initialize(context) {
    const contentStore = context.getService('ContentStore');
    const store = context.getService('ContentAddressableStore');
    store.initialize({ contentStore });
}
