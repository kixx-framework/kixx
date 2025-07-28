import fsp from 'node:fs/promises';
import path from 'node:path';
import { EOL } from 'node:os';

export const description = 'Save your test file to a known location so that it can be reviewed by your team and other contributors to this project. You do not need to specify a file location since it has been predetermined.';

export const input_schema = {
    type: 'object',
    required: [ 'test_file' ],
    properties: {
        test_file: {
            type: 'string',
            description: 'The JavaScript text content of the test source file to save.',
        },
    },
};

export async function main(filepath, textContent) {
    textContent = textContent.trim() + EOL;
    const dirname = path.dirname(filepath);
    await fsp.mkdir(dirname, { recursive: true });
    await fsp.writeFile(filepath, textContent);
    return { filepath };
}
