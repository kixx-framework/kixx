import process from 'node:process';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertNonEmptyString, assertEqual } from 'kixx-assert';
import ClaudeClient, { MODELS } from '../claude/claude-client.js';
import ClaudeMessage from '../claude/claude-message.js';
import * as toolSaveTestFile from './tool-save-test-file.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIRNAME = path.dirname(path.dirname(path.dirname(__dirname)));

const DEFAULT_MODEL = MODELS.claudeSonnet4.id;

/* eslint-disable no-console */

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
    const relativePath = path.relative(ROOT_DIRNAME, srcFilepath);
    const destFilepath = path.join(ROOT_DIRNAME, 'test', relativePath).replace(/\.js$/, '.test.js');

    const secrets = await getSecrets();

    const client = new ClaudeClient({
        defaultModel: DEFAULT_MODEL,
        apiKey: secrets.anthropic.api_key,
    });

    const modelRole = await getModelRole();

    const chainOfThought = await createTestPlan(client, modelRole, srcFilepath);

    await createTests(client, modelRole, chainOfThought, destFilepath);
}

async function createTestPlan(client, modelRole, srcFilepath) {
    const prompt = await getTestPlanPrompt(srcFilepath);

    const message = new ClaudeMessage({
        max_tokens: 32000,
        system: modelRole,
        thinking: {
            type: 'enabled',
            budget_tokens: 4096,
        },
        messages: [
            {
                role: 'user',
                content: prompt,
            },
        ],
    });

    const { requestId, statusCode, error, response } = await client.sendMessage(message);

    console.log('Get test plan: Turn 1:', JSON.stringify({ requestId, statusCode }));

    if (error) {
        console.log('Error:', JSON.stringify(error, null, 2));
        throw new Error('Claude API error');
    }

    if (response.stop_reason !== 'end_turn') {
        throw new Error(`Expected stop_reason to be 'end_turn' but got ${ response.stop_reason }`);
    }

    const chainOfThought = [{
        role: 'user',
        content: prompt,
    }];

    for (const content of response.content) {
        if (content.type === 'thinking') {
            logThinking(content);
        } else if (content.type === 'text') {
            logText(content);
            chainOfThought.push({
                role: 'assistant',
                content: content.text,
            });
        } else {
            console.log(`Unexpected response content type: ${ content.type }`);
        }
    }

    return chainOfThought;
}

async function createTests(client, modelRole, chainOfThought, destFilepath) {
    const prompt = await getCreateTestsPrompt();

    chainOfThought.push({
        role: 'user',
        content: prompt,
    });

    const message = new ClaudeMessage({
        max_tokens: 32000,
        system: modelRole,
        tools: [
            {
                name: 'save_test_file',
                description: toolSaveTestFile.description,
                input_schema: toolSaveTestFile.input_schema,
            },
        ],
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        thinking: {
            type: 'enabled',
            budget_tokens: 2048,
        },
        messages: chainOfThought,
    });

    const { requestId, statusCode, error, response } = await client.sendMessage(message);

    console.log('Create tests: Turn 1:', JSON.stringify({ requestId, statusCode }));

    if (error) {
        console.log('Error:', JSON.stringify(error, null, 2));
        throw new Error('Claude API error');
    }

    if (response.stop_reason !== 'tool_use') {
        throw new Error(`Expected stop_reason to be 'tool_use' but got ${ response.stop_reason }`);
    }

    for (const content of response.content) {
        if (content.type === 'thinking') {
            logThinking(content);
        } else if (content.type === 'text') {
            logText(content);
        } else if (content.type === 'tool_use') {
            assertEqual('save_test_file', content.name);
            assertNonEmptyString(content.input.test_file, 'test_file');
            logToolUse(content);
            // eslint-disable-next-line no-await-in-loop
            await toolSaveTestFile.main(destFilepath, content.input.test_file);
        } else {
            console.log(`Unexpected response content type: ${ content.type }`);
        }
    }
}

async function getTestPlanPrompt(srcFilepath) {
    const srcFileContent = await fsp.readFile(srcFilepath, { encoding: 'utf8' });
    const guidelines = await fsp.readFile(path.join(__dirname, 'test-guidelines.md'), { encoding: 'utf8' });
    const utf8 = await fsp.readFile(path.join(__dirname, 'prompt-create-plan.md'), { encoding: 'utf8' });

    return utf8
        .replace('{{guidelines}}', guidelines)
        .replace('{{source_file}}', srcFileContent);
}

async function getCreateTestsPrompt() {
    const assertions = await fsp.readFile(path.join(__dirname, 'assertions.md'), { encoding: 'utf8' });
    const testFramework = await fsp.readFile(path.join(__dirname, 'kixx-test.md'), { encoding: 'utf8' });
    const utf8 = await fsp.readFile(path.join(__dirname, 'prompt-create-tests.md'), { encoding: 'utf8' });

    return utf8
        .replace('{{assertions}}', assertions)
        .replace('{{test_framework}}', testFramework);
}

function logThinking(content) {
    console.log(`<Thinking>\n${ content.thinking }\n</Thinking>\n`);
}

function logText(content) {
    console.log(`<Text>\n${ content.text }\n</Text>\n`);
}

function logToolUse(content) {
    console.log(`<ToolUse>\n${ content.name }\n</ToolUse>\n`);
}

async function getModelRole() {
    const utf8 = await fsp.readFile(path.join(__dirname, 'model-role.md'), { encoding: 'utf8' });
    return utf8;
}

async function getSecrets() {
    const utf8 = await fsp.readFile(path.join(ROOT_DIRNAME, '.secrets.json'), { encoding: 'utf8' });
    return JSON.parse(utf8);
}

main().catch((error) => {
    console.error('Script execution failed. Stack trace:');
    console.error(error);
    process.exit(1);
});
