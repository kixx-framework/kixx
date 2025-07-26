export default class ClaudeResponse {
    constructor(headers, response) {
        this.requestId = headers['request-id'] || null;
        this.id = response.id;

        this.model = response.model;
        this.type = response.type;

        this.stop_reason = response.stop_reason;
        this.stop_sequence = response.stop_sequence;

        this.role = response.role;
        this.content = response.content;

        this.container = response.container;
        this.usage = response.usage;
    }
}
