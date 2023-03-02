// @ts-check

import KixxAssert from 'kixx-assert';

const { isNonEmptyString, isObject } = KixxAssert.helpers;


export default class WrappedHttpResponse {

    body = null;
    headers = new Headers();
    status = 200;
    statusText;

    setResponse(body, options) {
        options = options || {};

        this.body = body;

        if (options.headers) {
            if (options.headers instanceof Headers) {
                this.headers = options.headers;
            } else if (isObject(options.headers)) {
                this.headers = new Headers(options.headers);
            }
        }

        this.status = options.status || 200;

        if (isNonEmptyString(options.statusText)) {
            this.statusText = options.statusText;
        }

        return this;
    }

    setStatus(status, statusText) {
        this.status = status;

        if (isNonEmptyString(statusText)) {
            this.statusText = statusText;
        }

        return this;
    }

    setHeader(key, value) {
        this.headers.set(key, value);
        return this;
    }

    appendHeader(key, value) {
        this.headers.append(key, value);
        return this;
    }
}
