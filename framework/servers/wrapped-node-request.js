// @ts-check

// These imports are for type checking.
// eslint-disable-next-line no-unused-vars
import { IncomingMessage } from 'node:http';
// eslint-disable-next-line no-unused-vars
import { Readable } from 'node:stream';

import WrappedHttpRequest from './wrapped-http-request.js';


export default class WrappedNodeRequest extends WrappedHttpRequest {

    /**
     * @type {IncomingMessage}
     */
    #nodeHttpRequest;

    constructor(spec) {
        const { nodeHttpRequest, url } = spec;

        super({
            url,
            method: nodeHttpRequest.method,
            headers: nodeHttpRequest.headers,
        });

        this.#nodeHttpRequest = nodeHttpRequest;
    }

    /**
     * @return {Readable}
     */
    getReadStream() {
        return this.#nodeHttpRequest;
    }

    /**
     * @return {Promise<Buffer>}
     */
    getBufferedData() {
        return new Promise((resolve, reject) => {
            const req = this.#nodeHttpRequest;

            const data = [];

            req.once('error', reject);

            req.on('end', function onDataEnd() {
                req.off('error', reject);
                resolve(Buffer.concat(data));
            });

            req.on('data', function onDataChunk(chunk) {
                data.push(chunk);
            });
        });
    }
}
