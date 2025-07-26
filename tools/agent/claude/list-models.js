import process from 'node:process';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ClaudeClient from './claude-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIRNAME = path.dirname(path.dirname(path.dirname(__dirname)));
const SECRETS_FILEPATH = path.join(ROOT_DIRNAME, '.secrets.json');


async function main() {
    const client = await createClaudeClient();

    const models = await client.listModels();

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(models, null, 2));
}

async function createClaudeClient() {
    const secretsUtf8 = await fsp.readFile(SECRETS_FILEPATH, { encoding: 'utf8' });
    const { anthropic } = JSON.parse(secretsUtf8);

    return new ClaudeClient({
        defaultModel: 'claude-opus-4-20250514',
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
