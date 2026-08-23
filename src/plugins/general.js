import * as contentAddressableStore from './content-addressable-store/plugin.js';
import * as hyperview from './hyperview/plugin.js';

export const plugins = new Map([
    [ 'contentAddressableStore', contentAddressableStore ],
    [ 'hyperview', hyperview ],
]);
