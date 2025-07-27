import process from 'node:process';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertNonEmptyString, assertEqual } from 'kixx-assert';
import ClaudeClient, { MODELS } from '../agent/claude/claude-client.js';
import ClaudeMessage from '../agent/claude/claude-message.js';
import * as toolSavePlan from './tool-save-plan.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIRNAME = path.dirname(path.dirname(__dirname));
const SECRETS_FILEPATH = path.join(ROOT_DIRNAME, '.secrets.json');
const TEST_DIRNAME = path.join(ROOT_DIRNAME, 'test');

const options = {
    src: {
        type: 'string',
        short: 's',
        multiple: false,
    },
};

/* eslint-disable no-console */

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

    const relativePath = path.relative(ROOT_DIRNAME, srcFilepath);
    const testDirname = path.join(TEST_DIRNAME, relativePath).replace(/\.js$/, '');

    const prompt = await getPromptCreatePlan(sourceCode);

    const message = new ClaudeMessage({
        max_tokens: 32000,
        tools: [
            {
                name: 'save_test_plan',
                description: toolSavePlan.description,
                input_schema: toolSavePlan.input_schema,
            },
        ],
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        system: 'You are a senior engineer with 10 years experience in building software and testing software components, and an expert in building JavaScript Node.js applications.',
        thinking: {
            type: 'enabled',
            budget_tokens: 2048,
        },
        messages: [
            {
                role: 'user',
                content: prompt,
            },
        ],
    });

    const { requestId, statusCode, error, response } = await client.sendMessage(message);

    console.log('Info:', JSON.stringify({ requestId, statusCode }));

    if (error) {
        console.log('Error:', JSON.stringify(error, null, 2));
    } else if (response.stop_reason !== 'tool_use') {
        console.log('Error:', `Expected stop_reason to be 'tool_use' but got ${ response.stop_reason }`);
    } else {
        for (const content of response.content) {
            if (content.type === 'thinking') {
                console.log(`[Thinking]\n\n${ content.thinking }`);
            } else if (content.type === 'text') {
                console.log(`[Text]\n\n${ content.text }`);
            } else if (content.type === 'tool_use') {
                assertEqual('save_test_plan', content.name);
                assertNonEmptyString(content.input.test_plan, 'test_plan');
                await toolSavePlan.main(content.input.test_plan, { testDirname });
            } else {
                console.log(`Unexpected response content type: ${ content.type }`);
            }
        }
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

async function getPromptCreatePlan(javascriptSourceCode) {
    const testGuidelines = await getTestGuidelines();
    const filepath = path.join(__dirname, 'prompt-create-plan.md');
    const utf8 = await fsp.readFile(filepath, { encoding: 'utf8' });

    return utf8
        .replace('{{javascript_file}}', javascriptSourceCode)
        .replace('{{test_guidelines}}', testGuidelines);
}

async function getTestGuidelines() {
    const filepath = path.join(__dirname, 'test-guidelines.md');
    const utf8 = await fsp.readFile(filepath, { encoding: 'utf8' });
    return utf8;
}

main().catch((error) => {
    console.error('Script execution failed. Stack trace:');
    console.error(error);
    process.exit(1);
});
