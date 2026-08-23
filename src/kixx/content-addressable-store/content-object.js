export class ContentObject {
    constructor(stats) {
        this.pathname = stats.pathname;
        this.hash = stats.hash;
        this.size = stats.size;
        this.metadata = stats.metadata;
    }
}

export class TextContentObject extends ContentObject {
    constructor(text, stats) {
        super(stats);
        this.text = text;
    }
}

export class JsonContentObject extends ContentObject {
    constructor(json, stats) {
        super(stats);
        this.json = JSON.parse(json);
    }
}

export class StreamContentObject extends ContentObject {
    constructor(stream, stats) {
        super(stats);
        this.stream = stream;
    }
}
