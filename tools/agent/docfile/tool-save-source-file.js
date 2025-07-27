import fsp from 'node:fs/promises';

export const description = 'Save your source file to a known location so that it can be reviewed by your team and other contributors to this project. You do not need to specify a file location since it has been predetermined.';

export const input_schema = {
    type: 'object',
    required: [ 'source_file' ],
    properties: {
        source_file: {
            type: 'string',
            description: 'The text content of the source file to save.',
        },
    },
};

export async function main(filepath, textContent) {
    await fsp.writeFile(filepath, textContent);
    return { filepath };
}
