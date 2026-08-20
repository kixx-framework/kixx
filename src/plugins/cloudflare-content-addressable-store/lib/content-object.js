import { bufferToString } from './addressing.js';


export class StatObject {
    constructor(spec) {
        this.kind = spec.kind;
        this.hash = spec.hash;
        this.size = spec.size;
        this.metadata = spec.metadata;
        this.etag = spec.etag;
    }
}


export class ContentObject extends StatObject {

    #bytes;

    constructor(bytes, spec) {
        super(spec);
        this.#bytes = bytes;
    }

    text() {
        return bufferToString(this.#bytes);
    }

    json() {
        return JSON.parse(this.text());
    }
}
