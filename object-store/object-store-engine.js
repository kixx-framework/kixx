import path from 'node:path';
import { readJSONFile, createReadStream } from '../lib/file-system.js';


export default class ObjectStoreEngine {

    #logger = null;

    constructor(options) {
        this.#logger = options.logger;
        this.directory = options.directory;
    }

    async getObjectResponse(objectId) {
        const statsFilepath = this.objectIdToStatsFilePath(objectId);
        const stats = await readJSONFile(statsFilepath);

        if (!stats) {
            this.#logger.debug('stats file not found', {
                objectId,
                filepath: statsFilepath,
            });
        }

        const filepath = this.objectIdToFilePath(objectId);
        const stream = createReadStream(filepath);

        if (!stream) {
            this.#logger.debug('object file not found', { objectId, filepath });
            return null;
        }

        stream.headers = new Headers({
            'Content-Type': stats.contentType,
            'Content-Length': stats.contentLength,
            'Last-Modified': stats.lastModified,
        });

        return stream;
    }

    objectIdToFilePath(objectId) {
        return path.join(this.directory, objectId);
    }

    objectIdToStatsFilePath(objectId) {
        return path.join(this.directory, `${ objectId }_stats.json`);
    }
}
