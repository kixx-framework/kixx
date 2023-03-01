// @ts-check

import WrappedHttpResponse from './wrapped-http-response.js';


export default class WrappedNodeResponse extends WrappedHttpResponse {

    #nodeHttpRequest = null;
    #nodeHttpResponse = null;

    constructor(spec) {
        super();
        this.#nodeHttpRequest = spec.nodeHttpRequest;
        this.#nodeHttpResponse = spec.nodeHttpResponse;
    }

    getWriteStream() {
        return this.#nodeHttpResponse;
    }
}
