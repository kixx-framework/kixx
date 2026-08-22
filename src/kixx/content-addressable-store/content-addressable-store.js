export default class ContentAddressableStore {

    normalizePathname(pathname) {
        return normalizePathname(pathname);
    }

    isValidPathname(pathname) {
        return isValidPathname(pathname);
    }

    async hashValue(value) {
        return await hashValue(value);
    }

    async openSnapshot(context) {
        const buildId = context.runtime.build.id ?? null;
        const index = await this.#store.getIndex(context, buildId);
        return new ContentSnapshot(this.#store, index);
    }
}
