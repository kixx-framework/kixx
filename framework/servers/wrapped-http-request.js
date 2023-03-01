// @ts-check

import { Readable } from 'node:stream';
import { JsonParsingError } from 'kixx-server-errors';


export default class WrappedHttpRequest {

    /**
     * @type {URL}
     */
    url;

    /**
     * @type {string}
     */
    method;

    /**
     * @type {Headers}
     */
    headers;

    constructor(spec) {
        Object.defineProperties(this, {
            url: {
                enumerable: true,
                value: spec.url,
            },
            method: {
                enumerable: true,
                value: spec.method,
            },
            headers: {
                enumerable: true,
                value: new Headers(spec.headers),
            },
        });
    }

    get canonicalURL() {
        return this.url.href;
    }

    getHeader(key) {
        return this.headers.get(key);
    }

    /**
     * @return {Readable}
     */
    getReadStream() {
        return new Readable();
    }

    /**
     * @return {Promise<Buffer>}
     */
    getBufferedData() {
        return Promise.resolve(new Buffer(''));
    }

    async getBufferedJSON() {
        const buff = await this.getBufferedData();
        const utf8Data = buff.toString('utf8');

        try {
            return JSON.parse(utf8Data);
        } catch (cause) {
            throw new JsonParsingError('Error parsing HTTP JSON body', { cause });
        }
    }
}
