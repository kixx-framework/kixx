import process from 'node:process';
import util from 'node:util';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EOL } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runTests } from 'kixx-test';


const USAGE = 'Usage: node run-tests.js [--skip <path>] [pathname ...]';

const ROOT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const TEST_ROOT = path.join(ROOT_DIRECTORY, 'test');

// Matches the *.test.js project naming convention. The leading `\.` keeps a
// module like `latest.js` from being collected as a test file.
const TEST_FILE_PATTERN = /\.test\.js$/;


// Signals an invocation problem the user can correct: a bad flag, a pathname
// outside the test root, or a missing target. Reported as a message on stderr
// instead of a stack trace.
class CommandLineError extends Error {
    constructor(message, showUsage) {
        super(message);
        this.name = 'CommandLineError';
        this.showUsage = Boolean(showUsage);
    }
}


async function main() {
    const args = parseCommandLineArguments();

    await assertTestRootExists(TEST_ROOT);

    const testPaths = args.positionals.map((p) => path.resolve(p));
    const skipPaths = (args.values.skip || []).map((p) => path.resolve(p));

    assertPathsInTestRoot(testPaths, TEST_ROOT, 'Test');
    assertPathsInTestRoot(skipPaths, TEST_ROOT, 'Skip');

    // Pathnames above are resolved from the caller's directory. Once they are,
    // pin the working directory to devkit/ so tests which read fixtures by
    // relative path pass no matter where the runner was invoked from.
    process.chdir(ROOT_DIRECTORY);

    const startTime = Date.now();
    let testCount = 0;
    let disabledTestCount = 0;
    let errorCount = 0;
    let testFiles;

    if (testPaths.length > 0) {
        testFiles = await readTestFilesFromPaths(testPaths, skipPaths);
    } else {
        testFiles = await readTestFilesFromDirectory(TEST_ROOT, skipPaths);
    }

    // Sorting the fully collected list, rather than each directory during the
    // walk, makes import order a pure function of the set of selected files.
    // Deduplication depends on this sort to put copies side by side.
    testFiles.sort(compareFilepaths);
    testFiles = dropDuplicateFilepaths(testFiles);

    for (const file of testFiles) {
        // eslint-disable-next-line no-await-in-loop
        await import(pathToFileURL(file.filepath));
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

        if (error) {
            errorCount += 1;
            write(`${ EOL }Test failed: Block [${ block.concatName(' - ') }]${ timeDelta }${ EOL }`);
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

        write(message + EOL, () => {
            process.exit(exitCode);
        });
    });
}

function parseCommandLineArguments() {
    try {
        return util.parseArgs({
            args: process.argv.slice(2),
            // Strict parsing rejects a misspelled flag rather than silently
            // running the full suite.
            strict: true,
            allowPositionals: true,
            options: {
                skip: { type: 'string', multiple: true },
            },
        });
    } catch (cause) {
        throw new CommandLineError(cause.message, true);
    }
}

async function assertTestRootExists(testRoot) {
    let stats;

    try {
        stats = await fsp.stat(testRoot);
    } catch (cause) {
        if (cause.code === 'ENOENT') {
            throw new CommandLineError(`Test root directory does not exist: ${ testRoot }`, false);
        }
        throw cause;
    }

    if (!stats.isDirectory()) {
        throw new CommandLineError(`Test root is not a directory: ${ testRoot }`, false);
    }
}

function assertPathsInTestRoot(filepaths, testRoot, label) {
    for (const filepath of filepaths) {
        if (!isPathInsideDirectory(filepath, testRoot)) {
            throw new CommandLineError(
                `${ label } pathname is outside the test root.${ EOL }` +
                `  Pathname  : ${ filepath }${ EOL }` +
                `  Test root : ${ testRoot }`,
                true,
            );
        }
    }
}

async function readTestFilesFromPaths(testPaths, skipPaths) {
    const testFiles = [];

    for (const testPath of testPaths) {
        let stats;
        try {
            // eslint-disable-next-line no-await-in-loop
            stats = await fsp.stat(testPath);
        } catch (cause) {
            if (cause.code === 'ENOENT') {
                throw new CommandLineError(`Test pathname does not exist: ${ testPath }`, false);
            }
            throw cause;
        }

        if (stats.isDirectory()) {
            // eslint-disable-next-line no-await-in-loop
            testFiles.push(...await readTestFilesFromDirectory(testPath, skipPaths));
        } else if (!isSkippedPath(testPath, skipPaths)) {
            testFiles.push({ filepath: testPath });
        }
    }

    return testFiles;
}

async function readTestFilesFromDirectory(directory, skipPaths) {
    const entries = await readDirectory(directory);
    const testFiles = [];

    // Skip paths apply to individual files as well as whole directories.
    for (const { filepath, stats } of entries) {
        if (isSkippedPath(filepath, skipPaths)) {
            continue;
        }

        if (stats.isDirectory()) {
            // eslint-disable-next-line no-await-in-loop
            testFiles.push(...await readTestFilesFromDirectory(filepath, skipPaths));
        } else if (stats.isFile() && TEST_FILE_PATTERN.test(filepath)) {
            testFiles.push({ filepath });
        }
    }

    return testFiles;
}

async function readDirectory(dirpath) {
    const entries = await fsp.readdir(dirpath);

    const promises = entries.map(async (entry) => {
        const filepath = path.join(dirpath, entry);
        const stats = await fsp.stat(filepath);
        return { filepath, stats };
    });

    return await Promise.all(promises);
}

function isSkippedPath(filepath, skipPaths) {
    return skipPaths.some((skipPath) => isPathInsideDirectory(filepath, skipPath));
}

function isPathInsideDirectory(filepath, directory) {
    const relativePath = path.relative(directory, filepath);

    // An empty relative path means the two paths are the same. A relative path
    // which walks up ('..') or stays absolute means filepath escapes directory.
    return relativePath === '' || (
        !relativePath.startsWith('..') &&
        !path.isAbsolute(relativePath)
    );
}

// Compares by UTF-16 code unit rather than with localeCompare(), which depends
// on the host ICU build and locale. A code unit comparison orders pathnames
// identically on every machine and runtime.
function compareFilepaths(a, b) {
    if (a.filepath === b.filepath) {
        return 0;
    }
    return a.filepath < b.filepath ? -1 : 1;
}

// Overlapping positional pathnames can collect the same file twice; the sort
// above puts copies side by side.
function dropDuplicateFilepaths(testFiles) {
    return testFiles.filter(({ filepath }, index) => {
        return index === 0 || filepath !== testFiles[index - 1].filepath;
    });
}

function write(msg, callback) {
    process.stdout.write(msg, callback);
}

main().catch((error) => {
    // Invocation problems go to stderr as a plain message so piping stdout to
    // a file still surfaces why the run failed.
    if (error instanceof CommandLineError) {
        const message = error.showUsage
            ? `${ error.message }${ EOL }${ USAGE }${ EOL }`
            : `${ error.message }${ EOL }`;

        process.stderr.write(message, () => {
            process.exit(1);
        });

        return;
    }

    // eslint-disable-next-line no-console
    console.error('Error running tests:');
    // eslint-disable-next-line no-console
    console.error(error);

    setTimeout(() => {
        process.exit(1);
    }, 500);
});
