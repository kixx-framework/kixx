import deepFreeze from '../lib/deep-freeze.js';
import deepMerge from '../lib/deep-merge.js';
import {
    assert,
    isNonEmptyString,
    isNumberNotNaN,
    isBoolean
} from '../assertions/mod.js';


export default class BaseHttpResponse {

    #props = Object.freeze({});

    constructor(id) {
        this.status = 200;
        this.headers = new Headers();
        this.body = null;

        Object.defineProperties(this, {
            id: {
                enumerable: true,
                value: id,
            },
        });
    }

    get props() {
        return this.#props;
    }

    updateProps(params) {
        const mergedParams = deepMerge(structuredClone(this.#props), params);
        this.#props = deepFreeze(mergedParams);
        return this;
    }

    setHeader(key, val) {
        this.headers.set(key, val);
        return this;
    }

    setCookie(key, val, options) {
        const {
            maxAge,
            secure,
            httpOnly,
            sameSite,
            path,
        } = options || {};

        let cookie = `${ key }=${ val }`;

        if (maxAge) {
            cookie = `${ cookie }; Max-Age=${ maxAge }`;
        }

        if (path) {
            cookie = `${ cookie }; Path=${ path }`;
        }

        if (secure || !isBoolean(secure)) {
            cookie = `${ cookie }; Secure`;
        }

        if (httpOnly || !isBoolean(httpOnly)) {
            cookie = `${ cookie }; HttpOnly`;
        }

        if (sameSite) {
            cookie = `${ cookie }; SameSite=${ sameSite }`;
        } else {
            cookie = `${ cookie }; SameSite=Lax`;
        }

        this.headers.set('set-cookie', cookie);

        return this;
    }

    respondWithRedirect(statusCode, newLocation) {
        assert(isNumberNotNaN(statusCode), ': statusCode must be a number');
        this.status = statusCode;
        this.headers.set('location', newLocation);
        return this;
    }

    respondWithJSON(statusCode, obj, options) {
        assert(isNumberNotNaN(statusCode), ': statusCode must be a number');

        options = options || {};

        let utf8;
        if (Number.isInteger(options.whiteSpace)) {
            utf8 = JSON.stringify(obj, null, options.whiteSpace);
        } else if (options.whiteSpace) {
            utf8 = JSON.stringify(obj, null, 4);
        } else {
            utf8 = JSON.stringify(obj);
        }

        utf8 += '\n';

        this.status = statusCode;

        if (isNonEmptyString(options.contentType)) {
            this.headers.set('content-type', options.contentType);
        } else {
            this.headers.set('content-type', 'application/json; charset=utf-8');
        }

        this.headers.set('content-length', this.getContentLengthForUTF8(utf8));

        this.body = utf8;

        return this;
    }

    respondWithHTML(statusCode, utf8, options) {
        assert(isNumberNotNaN(statusCode), ': statusCode must be a number');
        assert(isNonEmptyString(utf8), ': response body must be a string');

        options = options || {};

        this.status = statusCode;

        if (isNonEmptyString(options.contentType)) {
            this.headers.set('content-type', options.contentType);
        } else {
            this.headers.set('content-type', 'text/html; charset=utf-8');
        }

        this.headers.set('content-length', this.getContentLengthForUTF8(utf8));

        this.body = utf8;

        return this;
    }

    respondNotModified() {
        const statusCode = 304;

        this.status = statusCode;

        this.headers.set('content-length', '0');
        this.body = null;

        return this;
    }

    respondWithStream(statusCode, contentLength, readStream) {
        assert(isNumberNotNaN(statusCode), ': statusCode must be a number');
        assert(isNumberNotNaN(contentLength), ': contentLength must be a number');

        this.status = statusCode;
        this.headers.set('content-length', contentLength.toString());
        this.body = readStream;
        return this;
    }

    getContentLengthForUTF8(utf8) {
        return new Blob([ utf8 ]).size;
    }
}
