import process from 'node:process';
import util from 'node:util';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EOL } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runTests } from 'kixx-test';


async function main() {
    const args = util.parseArgs({
        args: process.argv.slice(2),
        strict: false,
        allowPositionals: true,
        options: {
            skip: { type: 'string', multiple: true },
        },
    });

    const testPaths = args.positionals.map((p) => path.resolve(p));

    const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
    const directory = path.join(rootDirectory, 'test');
    const pattern = /test.js$/;
    const skipPaths = (args.values.skip || []).map((p) => path.resolve(p));

    const startTime = Date.now();
    let testCount = 0;
    let disabledTestCount = 0;
    let errorCount = 0;
    let testFiles;

    if (testPaths.length > 0) {
        testFiles = await readTestFilesFromPaths(testPaths, pattern, skipPaths);
    } else {
        // Load all test files from the full, nested test directory.
        testFiles = await readTestFilesFromDirectory(directory, pattern, skipPaths);
    }

    testFiles.sort(compareFilepaths);
    for (const file of testFiles) {
        // eslint-disable-next-line no-await-in-loop
        await dynamicallyImportFile(file);
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
        if (block.disabled) {
            if (block.type === 'test') {
                disabledTestCount += 1;
            }
            write(`${ EOL }Disabled Block: [${ block.concatName(' - ') }]${ EOL }`);
            return;
        }

        if (block.type === 'test') {
            testCount += 1;
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

        const prefix = `${ EOL + EOL }Test run is complete. Ran ${ testCount } tests ` +
            `with ${ disabledTestCount } disabled tests in ${ timeElapsed }ms.${ EOL }`;

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

async function readTestFilesFromPaths(testPaths, pattern, skipPaths = []) {
    const testFiles = [];

    for (const testPath of testPaths) {
        let stats;
        try {
            // eslint-disable-next-line no-await-in-loop
            stats = await fsp.stat(testPath);
        } catch (cause) {
            if (cause.code === 'ENOENT') {
                write(`Test path does not exist: ${ testPath }${ EOL }`);
                process.exit(1);
            }
            throw cause;
        }
        if (stats.isDirectory()) {
            // eslint-disable-next-line no-await-in-loop
            testFiles.push(...await readTestFilesFromDirectory(testPath, pattern, skipPaths));
        } else if (!isSkippedPath(testPath, skipPaths)) {
            testFiles.push({ filepath: testPath, stats });
        }
    }

    return testFiles;
}

async function readTestFilesFromDirectory(directory, pattern, skipPaths = []) {
    const testFiles = await readTestFiles(directory, pattern);
    const subDirectories = await readSubDirectories(directory);

    for (const { filepath } of subDirectories) {
        if (!skipPaths.includes(filepath)) {
            // eslint-disable-next-line no-await-in-loop
            testFiles.push(...await readTestFilesFromDirectory(filepath, pattern, skipPaths));
        }
    }

    return testFiles;
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

function isSkippedPath(filepath, skipPaths) {
    return skipPaths.some((skipPath) => {
        const relativePath = path.relative(skipPath, filepath);
        return relativePath === '' || (
            relativePath &&
            !relativePath.startsWith('..') &&
            !path.isAbsolute(relativePath)
        );
    });
}

function compareFilepaths(a, b) {
    return a.filepath.localeCompare(b.filepath);
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
