export default class ContentAddressableIndex {
    getNode(pathname) {
        const tuple = this.files[pathname];
        if (tuple) {
            const [ kind, hash, size, metadata ] = tuple;
            return {
                pathname,
                kind,
                hash,
                size,
                metadata,
            };
        }
        return null;
    }
}
