import process from 'node:process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assertNonEmptyString, assertEqual } from 'kixx-assert';
import ClaudeClient, { MODELS } from '../claude/claude-client.js';
import ClaudeMessage from '../claude/claude-message.js';
import * as toolSaveSourceFile from './tool-save-source-file.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIRNAME = path.dirname(path.dirname(path.dirname(__dirname)));
const SECRETS_FILEPATH = path.join(ROOT_DIRNAME, '.secrets.json');
const MODEL_ROLE_FILEPATH = path.join(__dirname, 'model-role.md');

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

    const secrets = await getSecrets();
    const srcFilepath = path.resolve(src);

    const client = new ClaudeClient({
        defaultModel: MODELS.claudeOpus4.id,
        apiKey: secrets.anthropic.api_key,
    });

    const modelRole = await getModelRole();

    await addInlineCodeComments(client, modelRole, srcFilepath);
    await addJSDocComments(client, modelRole, srcFilepath);
}

async function addJSDocComments(client, modelRole, srcFilepath) {
    const prompt = await getJSDocCommentsPrompt(srcFilepath);

    const message = new ClaudeMessage({
        max_tokens: 32000,
        system: modelRole,
        tools: [
            {
                name: 'save_source_file',
                description: toolSaveSourceFile.description,
                input_schema: toolSaveSourceFile.input_schema,
            },
        ],
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
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

    console.log('Get JSDoc comments: Turn 1:', JSON.stringify({ requestId, statusCode }));

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
            assertEqual('save_source_file', content.name);
            assertNonEmptyString(content.input.source_file, 'source_file');
            logToolUse(content);
            // eslint-disable-next-line no-await-in-loop
            await toolSaveSourceFile.main(srcFilepath, content.input.source_file);
        } else {
            console.log(`Unexpected response content type: ${ content.type }`);
        }
    }
}

async function addInlineCodeComments(client, modelRole, srcFilepath) {
    const prompt = await getInlineCodeCommentsPrompt(srcFilepath);

    const message = new ClaudeMessage({
        max_tokens: 32000,
        system: modelRole,
        tools: [
            {
                name: 'save_source_file',
                description: toolSaveSourceFile.description,
                input_schema: toolSaveSourceFile.input_schema,
            },
        ],
        tool_choice: { type: 'auto', disable_parallel_tool_use: true },
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

    console.log('Get inline code comments: Turn 1:', JSON.stringify({ requestId, statusCode }));

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
            assertEqual('save_source_file', content.name);
            assertNonEmptyString(content.input.source_file, 'source_file');
            logToolUse(content);
            // eslint-disable-next-line no-await-in-loop
            await toolSaveSourceFile.main(srcFilepath, content.input.source_file);
        } else {
            console.log(`Unexpected response content type: ${ content.type }`);
        }
    }
}

async function getJSDocCommentsPrompt(srcFilepath) {
    const srcFileContent = await fsp.readFile(srcFilepath, { encoding: 'utf8' });
    const guidelines = await fsp.readFile(path.join(__dirname, 'jsdoc-guidelines.md'), { encoding: 'utf8' });
    const utf8 = await fsp.readFile(path.join(__dirname, 'jsdoc-prompt.md'), { encoding: 'utf8' });

    return utf8
        .replace('{{guidelines}}', guidelines)
        .replace('{{source_file}}', srcFileContent);
}

async function getInlineCodeCommentsPrompt(srcFilepath) {
    const srcFileContent = await fsp.readFile(srcFilepath, { encoding: 'utf8' });
    const guidelines = await fsp.readFile(path.join(__dirname, 'comment-guidelines.md'), { encoding: 'utf8' });
    const utf8 = await fsp.readFile(path.join(__dirname, 'inline-comments-prompt.md'), { encoding: 'utf8' });

    return utf8
        .replace('{{guidelines}}', guidelines)
        .replace('{{source_file}}', srcFileContent);
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
    const utf8 = await fsp.readFile(MODEL_ROLE_FILEPATH, { encoding: 'utf8' });
    return utf8;
}

async function getSecrets() {
    const utf8 = await fsp.readFile(SECRETS_FILEPATH, { encoding: 'utf8' });
    return JSON.parse(utf8);
}

main().catch((error) => {
    console.error('Script execution failed. Stack trace:');
    console.error(error);
    process.exit(1);
});
