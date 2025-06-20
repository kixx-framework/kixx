import querystring from 'node:querystring';
import { BadRequestError } from '../errors/mod.js';
import { objectToHeaders } from '../lib/http-utils.js';
import deepFreeze from '../lib/deep-freeze.js';


export default class BaseServerRequest {

    #nodeRequest = null;

    #hostnameParams = Object.freeze({});
    #pathnameParams = Object.freeze({});

    constructor(req, url, id) {

        this.#nodeRequest = req;

        Object.defineProperties(this, {
            id: {
                enumerable: true,
                value: id,
            },
            method: {
                enumerable: true,
                value: req.method,
            },
            headers: {
                enumerable: true,
                value: objectToHeaders(req.headers),
            },
            url: {
                enumerable: true,
                value: url,
            },
        });
    }

    get hostnameParams() {
        return this.#hostnameParams;
    }

    get pathnameParams() {
        return this.#pathnameParams;
    }

    get queryParams() {
        return this.url.searchParams;
    }

    isHeadRequest() {
        return this.method === 'HEAD';
    }

    isJSONRequest() {
        if (this.headers.get('content-type')?.includes('application/json')) {
            return true;
        }
        if (this.url.pathname.endsWith('.json')) {
            return true;
        }
        if (this.headers.get('accept')?.includes('application/json')) {
            return true;
        }
        return false;
    }

    isFormURLEncodedRequest() {
        return this.headers.get('content-type')?.includes('application/x-www-form-urlencoded');
    }

    setPathnameParams(params) {
        this.#pathnameParams = deepFreeze(structuredClone(params));
        return this;
    }

    setHostnameParams(params) {
        this.#hostnameParams = deepFreeze(structuredClone(params));
        return this;
    }

    // Only capable of extracting string values.
    getCookie(keyname) {
        const cookies = this.getCookies();
        if (!cookies) {
            return null;
        }
        return cookies[ keyname ] || null;
    }

    getCookies() {
        const cookies = this.headers.get('cookie');
        if (!cookies) {
            return null;
        }

        // Split on semicolons and process each cookie
        const cookieMap = cookies
            .split(';')
            .map((cookie) => cookie.trim())
            .reduce((acc, cookie) => {
                // Skip empty cookies
                if (!cookie) {
                    return acc;
                }

                const [ key, ...valueParts ] = cookie.split('=');
                // Handle cookies with = in the value by rejoining
                const value = valueParts.join('=');
                acc[ key.trim() ] = value?.trim() || '';
                return acc;
            }, {});

        return cookieMap;
    }

    getAuthorizationBearer() {
        const authHeader = this.headers.get('authorization');
        if (!authHeader) {
            return null;
        }

        const [ scheme, token ] = authHeader.split(/\s+/, 2);

        if (!/^bearer$/i.test(scheme)) {
            return null;
        }

        return token || null;
    }

    getReadStream() {
        return this.#nodeRequest;
    }

    async json() {
        const data = await this.getBufferedStringData('utf8');

        let json;
        try {
            json = JSON.parse(data);
        } catch (cause) {
            throw new BadRequestError(`Error parsing HTTP JSON body: ${ cause.message }`, { cause });
        }

        return json;
    }

    async formData() {
        const utf8 = await this.getBufferedStringData('utf8');
        return querystring.parse(utf8);
    }

    getBufferedStringData(encoding) {
        return new Promise((resolve, reject) => {
            const req = this.#nodeRequest;

            const chunks = [];

            req.once('error', reject);

            req.on('data', (chunk) => {
                chunks.push(chunk);
            });

            req.on('end', () => {
                req.off('error', reject);

                const data = Buffer.concat(chunks).toString(encoding);

                resolve(data);
            });
        });
    }
}
