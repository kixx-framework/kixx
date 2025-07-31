import { NotFoundError } from '../../errors/mod.js';
import { isValidDate, assertNonEmptyString } from '../../assertions/mod.js';

const NAMESPACE = 'Kixx.ObjectStoreReader';


export default function ObjectStoreReader(options = {}) {

    return async function objectStoreReader(context, request, response) {
        const objectStore = context.getService('kixx.ObjectStore');
        const config = context.config.getNamespace(NAMESPACE);

        const { id } = request.pathnameParams;
        assertNonEmptyString(id, 'ObjectStoreReader request pathname id');

        const cacheControl = options.cacheControl || config.cacheControl || 'no-cache';

        const objectSource = await objectStore.getObjectStreamByReference(id);

        if (!objectSource) {
            throw new NotFoundError(`The object "${ id }" does not exist`);
        }

        response.updateHeaders(objectSource.headers);
        response.setHeader('cache-control', cacheControl);

        // Check for a conditional request.
        const ifModifiedSince = request.headers.get('if-modified-since');

        if (ifModifiedSince) {
            const modifiedDate = new Date(objectSource.headers.get('Last-Modified'));
            const ifModifiedSinceDate = new Date(ifModifiedSince);

            if (isValidDate(modifiedDate) && isValidDate(ifModifiedSinceDate) && modifiedDate > ifModifiedSinceDate) {
                // Destroy the open ReadStream before returning.
                objectSource.destroy();
                return response.respondNotModified();
            }
        }

        if (request.isHeadRequest()) {
            // Destroy the open ReadStream before returning.
            objectSource.destroy();
            return response.respondWithStream(200, null, null);
        }

        return response.respondWithStream(200, null, objectSource);
    };
};
