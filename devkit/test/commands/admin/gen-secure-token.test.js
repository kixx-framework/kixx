import { describe } from 'kixx-test';
import { assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';
import GenSecretTokenCommand from '../../../commands/admin/gen-secure-token.js';
import captureOutput from '../../helpers/capture-output.js';


describe('admin gen-secure-token', ({ it }) => {

    it('writes a 256-bit lowercase hex token', () => {
        const output = captureOutput();
        const code = new GenSecretTokenCommand({ output }).run({});

        assertEqual(0, code);
        assertEqual(1, output.chunks.length);
        assertMatches(/^[0-9a-f]{64}\n$/, output.chunks[0]);
    });

    it('prepends the literal prefix', () => {
        const output = captureOutput();

        new GenSecretTokenCommand({ output }).run({ prefix: 'kx_' });

        assertMatches(/^kx_[0-9a-f]{64}\n$/, output.chunks[0]);
    });

    it('writes a different token on each run', () => {
        const output = captureOutput();
        const command = new GenSecretTokenCommand({ output });

        command.run({});
        command.run({});

        assertEqual(false, output.chunks[0] === output.chunks[1]);
    });
});
