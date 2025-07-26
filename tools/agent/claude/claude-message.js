import { isNonEmptyString, isNumberNotNaN } from 'kixx-assert';

export default class ClaudeMessage {

    constructor(options) {
        this.model = options.model;
        this.max_tokens = options.max_tokens;
        this.container = options.container;
        this.stop_sequences = options.stop_sequences;
        this.temperature = options.temperature;
        this.tools = options.tools;
        this.tool_choice = options.tool_choice;
        this.system = options.system;
        this.thinking = options.thinking;
        this.messages = options.messages;
        this.metadata = options.metadata;
    }

    useDefaults(defaults) {
        this.model = isNonEmptyString(this.model) ? this.model : defaults.model;
        this.max_tokens = isNumberNotNaN(this.max_tokens) ? this.max_tokens : defaults.max_tokens;
    }

    toJSON() {
        return {
            max_tokens: this.max_tokens,
            model: this.model,
        };
    }
}
