import process from 'node:process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runTests } from 'kixx-test';

import { EOL } from 'node:os';

const RED = `\x1b[31m`;
const GREEN = `\x1b[32m`;
const YELLOW = `\x1b[33m`;
const COLOR_RESET = `\x1b[0m`;

const MAX_STACK_LENGTH = 4;


async function main() {
    const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
    const directory = path.join(rootDirectory, 'test');
    const pattern = /test.js$/;

    const startTime = Date.now();
    let testCount = 0;
    let errorCount = 0;

    await loadTestFilesFromDirectory(directory, pattern);

    const emitter = runTests();

    emitter.on('error', (error) => {
        // eslint-disable-next-line no-console
        console.error('Error event while running tests:');
        // eslint-disable-next-line no-console
        console.error(error);

        setTimeout(() => {
            process.exit(1);
        }, 500);
    });

    emitter.on('multipleResolves', ({ block }) => {
        errorCount += 1;
        write(`${ EOL }${ RED }Error: Block [${ block.concatName(' - ') }] had multiple resolves${ COLOR_RESET }${ EOL }`);
    });

    emitter.on('multipleRejections', ({ block, error }) => {
        errorCount += 1;
        write(`${ EOL }${ RED }Error: Block [${ block.concatName(' - ') }] had multiple rejections${ COLOR_RESET }${ EOL }`);
        if (error) {
            const stack = error.stack.split(EOL).map((line) => line.trimEnd()).slice(0, MAX_STACK_LENGTH);
            for (const line of stack) {
                write(line + EOL);
            }
        }
    });

    emitter.on('describeBlockStart', ({ block }) => {
        if (block.disabled) {
            write(`${ EOL }${ YELLOW }Disabled Describe Block: [${ block.concatName(' - ') }]${ COLOR_RESET }${ EOL }`);
        }
    });

    emitter.on('blockComplete', ({ block, start, end, error }) => {
        if (block.type === 'test') {
            testCount += 1;
            write('.');
        }

        if (block.disabled) {
            write(`${ EOL }${ YELLOW }Disabled Block: [${ block.concatName(' - ') }]${ COLOR_RESET }${ EOL }`);
            return;
        }

        let timeDelta = '';
        if ((end - start) > 1) {
            timeDelta = ` (${ end - start }ms)`;
        }

        const suffix = `Block [${ block.concatName(' - ') }]${ timeDelta }`;

        if (error) {
            errorCount += 1;
            write(`${ EOL }${ RED }Test failed: ${ suffix }${ COLOR_RESET }${ EOL }`);
            const stack = error.stack.split(EOL).map((line) => line.trimEnd()).slice(0, MAX_STACK_LENGTH);
            for (const line of stack) {
                write(line + EOL);
            }
        }
    });

    emitter.on('complete', () => {
        const timeElapsed = Date.now() - startTime;
        let exitCode = 0;

        const prefix = `${ EOL + EOL }Test run is complete. Ran ${ testCount } tests in ${ timeElapsed }ms.${ EOL }`;

        let message;
        if (errorCount > 0) {
            exitCode = 1;
            message = `${ prefix }${ RED }Failed with ${ errorCount } errors${ COLOR_RESET }`;
        } else {
            message = `${ prefix }${ GREEN }Passed with no errors${ COLOR_RESET }`;
        }

        message += EOL;

        write(message, () => {
            process.exit(exitCode);
        });
    });
}

async function loadTestFilesFromDirectory(directory, pattern) {
    let promises;

    const testFiles = await readTestFiles(directory, pattern);
    promises = testFiles.map(dynamicallyImportFile);
    await Promise.all(promises);

    const subDirectories = await readSubDirectories(directory);
    promises = subDirectories.map(({ filepath }) => {
        return loadTestFilesFromDirectory(filepath, pattern);
    });
    await Promise.all(promises);
}

async function readTestFiles(directory, pattern) {
    const files = await readDirectory(directory);

    return files.filter(({ filepath, stats }) => {
        return stats.isFile() && pattern.test(filepath);
    });
}

async function readSubDirectories(parentDirectory) {
    const files = await readDirectory(parentDirectory);

    return files.filter(({ stats }) => {
        return stats.isDirectory();
    });
}

async function dynamicallyImportFile({ filepath }) {
    await import(pathToFileURL(filepath));
}

async function readDirectory(dirpath) {
    const entries = await fsp.readdir(dirpath);

    const promises = entries.map((entry) => {
        const filepath = path.join(dirpath, entry);
        return fsp.stat(filepath).then((stats) => {
            return { filepath, stats };
        });
    });

    return Promise.all(promises);
}

function write(msg, callback) {
    process.stdout.write(msg, callback);
}

main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Error running tests:');
    // eslint-disable-next-line no-console
    console.error(error);

    setTimeout(() => {
        process.exit(1);
    }, 500);
});
