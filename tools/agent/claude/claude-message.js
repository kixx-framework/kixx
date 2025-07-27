import {
    isNonEmptyString,
    isNumberNotNaN,
    assertArray,
    assertNonEmptyString,
    assertNumberNotNaN
} from 'kixx-assert';

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
        assertNonEmptyString(this.model, 'model');
        assertNumberNotNaN(this.max_tokens, 'max_tokens');
        assertArray(this.messages, 'messages');

        return {
            model: this.model,
            max_tokens: this.max_tokens,
            container: this.container,
            stop_sequences: this.stop_sequences,
            temperature: this.temperature,
            tools: this.tools,
            tool_choice: this.tool_choice,
            system: this.system,
            thinking: this.thinking,
            messages: this.messages,
            metadata: this.metadata,
        };
    }
}
