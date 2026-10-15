import { PassThrough } from 'node:stream';

import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../lib/vendor/kixx-assert/mod.js';

import * as prompt from '../../lib/prompt.js';

const { promptForValue, promptForValueTwice } = prompt;

const ENV_VAR = 'KIXX_TEST_PROMPT_VALUE';


describe('prompt', ({ it }) => {

    it('exports no confirmation prompt', () => {
        assertEqual('promptForValue,promptForValueTwice', Object.keys(prompt).sort().join(','));
    });

    it('returns a set environment variable without reading the input stream', async () => {
        const input = makeTerminal({ isTTY: true });

        const value = await promptForValue({
            envVar: ENV_VAR,
            label: 'Value',
            input,
            output: input.output,
            env: { [ENV_VAR]: 'from-env' },
        });

        assertEqual('from-env', value);
        assertEqual('', input.written());
    });

    it('treats an empty or whitespace-only environment variable as absent', async () => {
        const input = makeTerminal({ isTTY: true });

        const promise = promptForValue({
            envVar: ENV_VAR,
            label: 'Value',
            input,
            output: input.output,
            env: { [ENV_VAR]: '   ' },
        });

        input.write('typed-value\n');

        assertEqual('typed-value', await promise);
    });

    it('reads a visible line from the input stream and returns it trimmed', async () => {
        const input = makeTerminal({ isTTY: true });

        const promise = promptForValue({
            envVar: ENV_VAR,
            label: 'Value',
            input,
            output: input.output,
            env: {},
        });

        input.write('  hello world  \n');

        assertEqual('hello world', await promise);
    });

    it('reads a masked line without echoing the typed characters', async () => {
        const input = makeTerminal({ isTTY: true });

        const promise = promptForValue({
            envVar: ENV_VAR,
            label: 'Secret',
            mask: true,
            input,
            output: input.output,
            env: {},
        });

        input.write('super-secret\n');

        assertEqual('super-secret', await promise);
        assert(!input.written().includes('super-secret'), 'the output stream contains the typed secret');
    });

    it('throws a UsageError naming the environment variable when stdin is not a TTY', async () => {
        const input = makeTerminal({ isTTY: false });

        const caught = await catchAsyncError(() => promptForValue({
            envVar: ENV_VAR,
            label: 'Value',
            input,
            output: input.output,
            env: {},
        }));

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(caught.message.includes(ENV_VAR), 'expected the message to name the env var');
    });

    it('produces a UsageError instead of hanging on EOF', async () => {
        const input = makeTerminal({ isTTY: true });

        const promise = promptForValue({
            envVar: ENV_VAR,
            label: 'Value',
            input,
            output: input.output,
            env: {},
        });

        input.end();
        const caught = await catchAsyncError(() => promise);

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
    });

    it('prompts twice and succeeds when both entries match', async () => {
        const input = makeTerminal({ isTTY: true });

        const promise = promptForValueTwice({
            envVar: ENV_VAR,
            label: 'Password',
            input,
            output: input.output,
            env: {},
        });

        input.write('matching-value\n');
        input.write('matching-value\n');

        assertEqual('matching-value', await promise);
    });

    it('returns the environment variable once without prompting twice', async () => {
        const input = makeTerminal({ isTTY: false });

        const value = await promptForValueTwice({
            envVar: ENV_VAR,
            label: 'Password',
            input,
            output: input.output,
            env: { [ENV_VAR]: 'from-env' },
        });

        assertEqual('from-env', value);
        assertEqual('', input.written());
    });

    it('throws a UsageError without revealing either value when entries differ', async () => {
        const input = makeTerminal({ isTTY: true });

        const promise = promptForValueTwice({
            envVar: ENV_VAR,
            label: 'Password',
            input,
            output: input.output,
            env: {},
        });

        input.write('first-value\n');
        input.write('second-value\n');
        const caught = await catchAsyncError(() => promise);

        assert(caught, 'expected an error to be thrown');
        assertEqual('UsageError', caught.name);
        assert(!caught.message.includes('first-value'));
        assert(!caught.message.includes('second-value'));
    });
});

function makeTerminal(options) {
    const { isTTY } = options ?? {};
    const input = new PassThrough();
    const output = new PassThrough();

    input.isTTY = isTTY;

    let buffer = '';
    output.on('data', (chunk) => {
        buffer += chunk.toString();
    });

    input.output = output;
    input.written = () => buffer;

    return input;
}

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}
