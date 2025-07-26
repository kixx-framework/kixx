import process from 'node:process';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertNonEmptyString } from 'kixx-assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIRNAME = path.dirname(path.dirname(__dirname));
const SECRETS_FILEPATH = path.join(ROOT_DIRNAME, 'secrets.json');

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

    const message = new ClaudeMessage({
        max_tokens: 1024,
        messages: [
            { role: 'user', content: 'Hello, world!' },
        ],
    });
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
