import process from 'node:process';
import { generateSecretToken } from '../../lib/crypto.js';

export default class GenSecretTokenCommand {

    static description = `
        Generate a 256-bit secure token encoded as lowercase hexadecimal
        text, suitable for things like the ADMIN_BOOTSTRAP_TOKEN
    `;

    static options = {
        prefix: {
            type: 'string',
            short: 'p',
            description: 'Optional literal prefix prepended to the random token body',
        },
    };

    #output;

    constructor(args) {
        const { output = process.stdout } = args ?? {};
        this.#output = output;
    }

    run(options) {
        const token = generateSecretToken(options.prefix);
        this.#output.write(`${ token }\n`);
        return 0;
    }
}
