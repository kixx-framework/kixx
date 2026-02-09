import process from 'node:process';
import util from 'node:util';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runTests } from 'kixx-test';
import { EOL } from 'node:os';


async function main() {
    const args = util.parseArgs({
        args: process.argv.slice(2),
        strict: false,
        allowPositionals: true,
    });

    let testPath = null;
    if (args.positionals[0]) {
        testPath = path.resolve(args.positionals[0]);
    }

    const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
    const directory = path.join(rootDirectory, 'test');
    const pattern = /test.js$/;

    const startTime = Date.now();
    let testCount = 0;
    let errorCount = 0;

    if (testPath) {
        let stats;
        try {
            stats = await fsp.stat(testPath);
        } catch (cause) {
            if (cause.code === 'ENOENT') {
                write(`Test path does not exist: ${ testPath }${ EOL }`);
                process.exit(1);
            }
            throw cause;
        }
        if (stats.isDirectory()) {
            // Load all test files from the specified directory.
            await loadTestFilesFromDirectory(testPath, pattern);
        } else {
            // Load the single test file specified on the CLI.
            await dynamicallyImportFile({ filepath: testPath });
        }
    } else {
        // Load all test files from the full, nested test directory.
        await loadTestFilesFromDirectory(directory, pattern);
    }

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
        write(`${ EOL }Error: Block [${ block.concatName(' - ') }] had multiple resolves${ EOL }`);
    });

    emitter.on('multipleRejections', ({ block, error }) => {
        errorCount += 1;
        write(`${ EOL }Error: Block [${ block.concatName(' - ') }] had multiple rejections${ EOL }`);
        if (error) {
            write(util.inspect(error, false, 2, true) + EOL);
        }
    });

    emitter.on('describeBlockStart', ({ block }) => {
        if (block.disabled) {
            write(`${ EOL }Disabled Describe Block: [${ block.concatName(' - ') }]${ EOL }`);
        }
    });

    emitter.on('blockComplete', ({ block, start, end, error }) => {
        if (block.type === 'test') {
            testCount += 1;
        }

        if (block.disabled) {
            write(`${ EOL }Disabled Block: [${ block.concatName(' - ') }]${ EOL }`);
            return;
        }

        let timeDelta = '';
        if ((end - start) > 1) {
            timeDelta = ` (${ end - start }ms)`;
        }

        const suffix = `Block [${ block.concatName(' - ') }]${ timeDelta }`;

        if (error) {
            errorCount += 1;
            write(`${ EOL }Test failed: ${ suffix }${ EOL }`);
            write(util.inspect(error, false, 2, true) + EOL);
        }
    });

    emitter.on('complete', () => {
        const timeElapsed = Date.now() - startTime;
        let exitCode = 0;

        const prefix = `${ EOL + EOL }Test run is complete. Ran ${ testCount } tests in ${ timeElapsed }ms.${ EOL }`;

        let message;
        if (errorCount > 0) {
            exitCode = 1;
            message = `${ prefix }Failed with ${ errorCount } errors`;
        } else {
            message = `${ prefix }Passed with no errors`;
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
