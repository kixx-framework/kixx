import { bufferToString } from './addressing.js';


export default class ContentObject {
    #bytes;

    constructor(bytes, spec) {
        this.pathname = spec.pathname;
        this.hash = spec.hash;
        this.size = spec.size;
        this.metadata = spec.metadata;
        this.#bytes = bytes;
    }

    text() {
        return bufferToString(this.#bytes);
    }

    json() {
        return JSON.parse(this.text());
    }
}
