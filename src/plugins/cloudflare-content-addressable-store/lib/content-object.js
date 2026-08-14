import { bufferToString, hashValue } from './addressing.js';


export class StatObject {
    constructor(spec) {
        this.pathname = spec.pathname;
        this.kind = spec.kind;
        this.hash = spec.hash;
        this.size = spec.size;
        this.metadata = spec.metadata;
    }

    async finalize() {
        // Include metadata in the etag if it exists.
        this.etag = await hashValue([ this.hash, this.metadata ]);
        return Object.freeze(this);
    }

    static async create(spec) {
        const stat = new StatObject(spec);
        return await stat.finalize();
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

    static async create(bytes, spec) {
        const stat = new ContentObject(bytes, spec);
        return await stat.finalize();
    }
}
