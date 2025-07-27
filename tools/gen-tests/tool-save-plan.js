import path from 'node:path';
import fsp from 'node:fs/promises';

export const description = 'Save your test plan to a known location so that it can be reviewed by your team and other contributors to this project. You do not need to specify a file location since it has been predetermined.';

export const input_schema = {
    type: 'object',
    required: [ 'test_plan' ],
    properties: {
        test_plan: {
            type: 'string',
            description: 'The test plan to save. This is the text content of the test plan.',
        },
    },
};

export async function main(textContent, options) {
    const { testDirname } = options;
    const testPlansDirname = path.join(testDirname, 'plans');
    const entries = await readdir(testPlansDirname);
    // Find the highest N in files named "plan_N.md"
    let maxN = 0;
    for (const entry of entries) {
        const match = /^plan_(\d+)\.md$/.exec(entry);
        if (match) {
            const n = Number(match[1]);
            if (Number.isInteger(n) && n > maxN) {
                maxN = n;
            }
        }
    }

    const filepath = path.join(testPlansDirname, `plan_${ maxN + 1 }.md`);

    await fsp.mkdir(testPlansDirname, { recursive: true });
    await fsp.writeFile(filepath, textContent);

    return { filepath };
}

async function readdir(dirname) {
    try {
        const entries = await fsp.readdir(dirname);
        return entries;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}
