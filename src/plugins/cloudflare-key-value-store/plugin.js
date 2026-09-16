import KeyValueStore from './lib/key-value-store.js';

export function register(context) {
    context.registerService('KeyValueStore', new KeyValueStore());
}
