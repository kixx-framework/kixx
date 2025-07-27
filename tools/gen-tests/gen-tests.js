import process from 'node:process';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertNonEmptyString } from 'kixx-assert';
import ClaudeClient, { MODELS } from '../agent/claude/claude-client.js';
import ClaudeMessage from '../agent/claude/claude-message.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIRNAME = path.dirname(path.dirname(__dirname));
const SECRETS_FILEPATH = path.join(ROOT_DIRNAME, '.secrets.json');

const options = {
    src: {
        type: 'string',
        short: 's',
        multiple: false,
    },
};


async function main() {
    const args = parseArgs({
        options,
        strict: true,
        allowPositionals: false,
    });

    const { src } = args.values;

    assertNonEmptyString(src, 'src argument');

    const srcFilepath = path.resolve(src);

    const sourceCode = await fsp.readFile(srcFilepath, { encoding: 'utf8' });

    const client = await createClaudeClient();

    const message = new ClaudeMessage({
        max_tokens: 32000,
        tools: [
            {
                name: 'save_test_file',
                description: 'Save a test source code file to the appropriate directory for the name of the component tested. The save_test_file tool will derive the name of the test file without any further input and is already aware of the directory it should go in. All the save_test_file tool requires for input is the source code for the tests.',
                input_schema: {
                    type: 'object',
                    required: [ 'source_code' ],
                    properties: {
                        source_code: {
                            type: 'string',
                            description: 'The generated test source code to write to the appropriate directory for the name of the component tested.',
                        },
                    },
                },
            },
        ],
        tool_choice: { type: 'tool', name: 'save_test_file' },
        messages: [
            {
                role: 'user',
                content: `Create unit tests for this file:\n\n<javascript_file>\n${ sourceCode }\n</javascript_file>.\n\nKeep all tests in a single file instead of splitting them into multiple files.`,
            },
        ],
    });

    const { requestId, statusCode, error, response } = await client.sendMessage(message);

    // eslint-disable-next-line no-console
    console.log('Info:', JSON.stringify({ requestId, statusCode }));

    if (error) {
        // eslint-disable-next-line no-console
        console.log('Error:', JSON.stringify(error, null, 2));
    } else {
        // eslint-disable-next-line no-console
        console.log(response.content[0]);
        // eslint-disable-next-line no-console
        console.log(response);
    }
}

async function createClaudeClient() {
    const secretsUtf8 = await fsp.readFile(SECRETS_FILEPATH, { encoding: 'utf8' });
    const { anthropic } = JSON.parse(secretsUtf8);

    return new ClaudeClient({
        defaultModel: MODELS.claudeOpus4.id,
        apiKey: anthropic.api_key,
    });
}

main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Script execution failed. Stack trace:');
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
});
