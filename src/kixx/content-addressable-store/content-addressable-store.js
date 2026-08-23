import ContentAddressableIndex from './content-addressable-index.js';
import ContentSnapshot from './content-snapshot.js';
import { hashString } from './addressing.js';
import { normalizePathname, isValidPathname } from './content-layout.js';
import { assert } from '../assertions/mod.js';


export default class ContentAddressableStore {

    #store;

    initialize(args) {
        const { contentStore } = args ?? {};
        assert(contentStore, 'ContentAddressableStore requires a ContentStore');
        this.#store = contentStore;
    }

    normalizePathname(pathname) {
        return normalizePathname(pathname);
    }

    isValidPathname(pathname) {
        return isValidPathname(pathname);
    }

    async hashString(value) {
        return await hashString(value);
    }

    async openSnapshot(context) {
        const buildId = context.runtime.build.id ?? null;
        const entries = await this.#store.getIndex(context, buildId);
        const index = new ContentAddressableIndex(entries);
        return new ContentSnapshot(this.#store, index);
    }
}
