export function createObjectStore(params) {
	const { storageEngine } = params;

	return {

		readObject(args, writeStream) {
			const { id } = args || {};
			return storageEngine.readObject({ id }, writeStream);
		},

		writeObject(args, readStream) {
			const { id, contentType } = args || {};
			return storageEngine.writeObject({ id, contentType }, readStream);
		},
	};
}
