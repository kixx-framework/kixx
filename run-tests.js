import process from 'node:process';
import util from 'node:util';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EOL } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runTests } from 'kixx-test';
import { isNonEmptyString } from './src/kixx/assertions/mod.js';


const USAGE = 'Usage: node run-tests.js [--e2e] [--skip <path>] ' +
    '[--base-url <url> | --development | --cloudflare | --nodejs] ' +
    '[--username <username>] [--password <password>] [pathname ...]';

const ROOT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

// The unit and end-to-end suites live in separate roots and exactly one of them
// is active for any single run. Selecting a root, rather than filtering a shared
// tree, is what guarantees the two suites never mix in the same process.
const UNIT_TEST_ROOT = path.join(ROOT_DIRECTORY, 'test', 'unit-tests');
const END_TO_END_TEST_ROOT = path.join(ROOT_DIRECTORY, 'test', 'end-to-end');

// Matches the *.test.js project naming convention.
const TEST_FILE_PATTERN = /test.js$/;

// End-to-end tests drive a running application, so the kixx-test default of
// 1000ms is unusable for them. This acts as a ceiling and not a floor: kixx-test
// resolves the runner option in preference to a block's own timeout, so an
// individual describe block cannot raise it above this value.
const END_TO_END_TIMEOUT = 10000;

const END_TO_END_OPTION_NAMES = [
    'base-url',
    'username',
    'password',
    'development',
    'cloudflare',
    'nodejs',
];

const END_TO_END_BASE_URL_OPTION_NAMES = [
    'base-url',
    'development',
    'cloudflare',
    'nodejs',
];

const END_TO_END_STRING_OPTION_NAMES = [
    'base-url',
    'username',
    'password',
];

const END_TO_END_BASE_URLS = new Map([
    [ 'development', 'http://localhost:2026/' ],
    [ 'cloudflare', 'https://cloudflare.kixx-testing.dev/' ],
    [ 'nodejs', 'https://nodejs.kixx-testing.dev/' ],
]);

const END_TO_END_ENVIRONMENT_VARIABLES = new Map([
    [ 'base-url', 'E2E_TESTS_BASE_URL' ],
    [ 'username', 'E2E_TESTS_ROOT_USERNAME' ],
    [ 'password', 'E2E_TESTS_ROOT_PASSWORD' ],
]);
const REQUIRED_END_TO_END_ENVIRONMENT_VARIABLES = [
    'E2E_TESTS_BASE_URL',
    'E2E_TESTS_ROOT_USERNAME',
    'E2E_TESTS_ROOT_PASSWORD',
];


// Signals an invocation problem the user can correct: a bad flag, a pathname
// outside the active suite, or a missing target. Reported as a message on stderr
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

    configureEndToEndEnvironment(args);

    const useEndToEnd = args.values.e2e;
    const testRoot = useEndToEnd ? END_TO_END_TEST_ROOT : UNIT_TEST_ROOT;

    // The root anchors every containment check below, so confirm it exists
    // before validating any pathname against it.
    await assertTestRootExists(testRoot);

    const testPaths = args.positionals.map((p) => path.resolve(p));
    const skipPaths = (args.values.skip || []).map((p) => path.resolve(p));

    // Positional and --skip pathnames are both constrained to the active root:
    // the mode flag selects a suite and every pathname must belong to it. This
    // is what makes a forgotten or misspelled --e2e fail loudly instead of
    // quietly running the other suite.
    assertPathsInTestRoot(testPaths, testRoot, 'Test');
    assertPathsInTestRoot(skipPaths, testRoot, 'Skip');

    const startTime = Date.now();
    let testCount = 0;
    let disabledTestCount = 0;
    let errorCount = 0;
    let testFiles;

    if (testPaths.length > 0) {
        testFiles = await readTestFilesFromPaths(testPaths, skipPaths);
    } else {
        // Load all test files from the full, nested root directory of the
        // active suite.
        testFiles = await readTestFilesFromDirectory(testRoot, skipPaths);
    }

    // Sorting the fully collected list, rather than each directory during the
    // walk, makes import order a pure function of the set of selected files:
    // readdir() order and the order of the positional arguments cannot reach
    // it. Deduplication depends on this sort to put copies side by side.
    testFiles.sort(compareFilepaths);
    testFiles = dropDuplicateFilepaths(testFiles);

    for (const file of testFiles) {
        // eslint-disable-next-line no-await-in-loop
        await dynamicallyImportFile(file);
    }

    // Only the end-to-end suite overrides the timeout, so unit test blocks keep
    // whatever timeout they declare for themselves.
    const emitter = useEndToEnd ? runTests({ timeout: END_TO_END_TIMEOUT }) : runTests();

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

function parseCommandLineArguments() {
    try {
        return util.parseArgs({
            args: process.argv.slice(2),
            // Strict parsing rejects an unknown or misspelled flag. Without it a
            // typo like --e2ee would silently run the unit suite and report a
            // green pass.
            strict: true,
            allowPositionals: true,
            tokens: true,
            options: {
                e2e: { type: 'boolean', default: false },
                skip: { type: 'string', multiple: true },
                'base-url': { type: 'string' },
                username: { type: 'string' },
                password: { type: 'string' },
                development: { type: 'boolean' },
                cloudflare: { type: 'boolean' },
                nodejs: { type: 'boolean' },
            },
        });
    } catch (cause) {
        // parseArgs throws for unknown options, missing option values, and
        // values given to boolean flags. All of those are usage mistakes, so
        // report the message rather than a Node internal stack trace.
        throw new CommandLineError(cause.message, true);
    }
}

function configureEndToEndEnvironment(args) {
    const suppliedOptionNames = args.tokens
        .filter(({ kind, name }) => {
            return kind === 'option' && END_TO_END_OPTION_NAMES.includes(name);
        })
        .map(({ name }) => name);

    assertOptionsNotRepeated(suppliedOptionNames);

    if (!args.values.e2e) {
        if (suppliedOptionNames.length > 0) {
            throw new CommandLineError(
                'End-to-end configuration options can only be used with --e2e.',
                true,
            );
        }
        return;
    }

    const suppliedOptions = new Set(suppliedOptionNames);

    assertBaseUrlOptionsDoNotConflict(suppliedOptions);
    assertStringOptionsAreNotEmpty(args.values, suppliedOptions);
    applyEndToEndEnvironmentOverrides(args.values, suppliedOptions);
    assertEndToEndEnvironmentIsComplete();
    assertBaseUrlIsValid(process.env.E2E_TESTS_BASE_URL);
}

function assertOptionsNotRepeated(optionNames) {
    const seen = new Set();

    for (const optionName of optionNames) {
        if (seen.has(optionName)) {
            throw new CommandLineError(
                `End-to-end configuration option --${ optionName } cannot be repeated.`,
                true,
            );
        }
        seen.add(optionName);
    }
}

function assertBaseUrlOptionsDoNotConflict(suppliedOptions) {
    const baseUrlOptions = END_TO_END_BASE_URL_OPTION_NAMES.filter((optionName) => {
        return suppliedOptions.has(optionName);
    });

    if (baseUrlOptions.length > 1) {
        throw new CommandLineError(
            'Only one base URL option may be used: ' +
                '--base-url, --development, --cloudflare, or --nodejs.',
            true,
        );
    }
}

function assertStringOptionsAreNotEmpty(values, suppliedOptions) {
    for (const optionName of END_TO_END_STRING_OPTION_NAMES) {
        if (suppliedOptions.has(optionName) && values[optionName] === '') {
            throw new CommandLineError(
                `End-to-end configuration option --${ optionName } cannot be empty.`,
                true,
            );
        }
    }
}

function applyEndToEndEnvironmentOverrides(values, suppliedOptions) {
    for (const [ optionName, environmentVariable ] of END_TO_END_ENVIRONMENT_VARIABLES) {
        if (suppliedOptions.has(optionName)) {
            process.env[environmentVariable] = values[optionName];
        }
    }

    for (const [ optionName, baseUrl ] of END_TO_END_BASE_URLS) {
        if (suppliedOptions.has(optionName)) {
            process.env.E2E_TESTS_BASE_URL = baseUrl;
        }
    }
}

function assertEndToEndEnvironmentIsComplete() {
    const missingVariables = REQUIRED_END_TO_END_ENVIRONMENT_VARIABLES
        .filter((environmentVariable) => {
            return !isNonEmptyString(process.env[environmentVariable]);
        });

    if (missingVariables.length > 0) {
        throw new CommandLineError(
            `Missing required end-to-end environment variables: ${ missingVariables.join(', ') }.`,
            true,
        );
    }
}

function assertBaseUrlIsValid(baseUrl) {
    if (baseUrl.trim() !== baseUrl) {
        throw new CommandLineError(
            'E2E_TESTS_BASE_URL cannot have leading or trailing whitespace.',
            true,
        );
    }

    let url;
    try {
        url = new URL(baseUrl);
    } catch {
        throw new CommandLineError(
            'E2E_TESTS_BASE_URL must be a valid absolute HTTP(S) URL.',
            true,
        );
    }

    if (![ 'http:', 'https:' ].includes(url.protocol) || !isNonEmptyString(url.hostname)) {
        throw new CommandLineError(
            'E2E_TESTS_BASE_URL must be a valid absolute HTTP(S) URL.',
            true,
        );
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
                `${ label } pathname is outside the active test root.${ EOL }` +
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
            testFiles.push({ filepath: testPath, stats });
        }
    }

    return testFiles;
}

async function readTestFilesFromDirectory(directory, skipPaths) {
    const files = await readTestFiles(directory);

    // Filter files here as well as pruning subdirectories below, so --skip
    // applies to an individual test file and not only to a whole directory.
    const testFiles = files.filter(({ filepath }) => !isSkippedPath(filepath, skipPaths));

    const subDirectories = await readSubDirectories(directory);

    for (const { filepath } of subDirectories) {
        if (!isSkippedPath(filepath, skipPaths)) {
            // eslint-disable-next-line no-await-in-loop
            testFiles.push(...await readTestFilesFromDirectory(filepath, skipPaths));
        }
    }

    return testFiles;
}

async function readTestFiles(directory) {
    const files = await readDirectory(directory);

    return files.filter(({ filepath, stats }) => {
        return stats.isFile() && TEST_FILE_PATTERN.test(filepath);
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

// Compares by UTF-16 code unit rather than with localeCompare(). Locale aware
// collation resolves against the host ICU build and the environment locale, so
// it can order the same pathnames differently between machines, and between
// Node.js and Deno. A code unit comparison is a total order over pathnames on
// every runtime, which is what makes a failing run reproduce elsewhere.
function compareFilepaths(a, b) {
    if (a.filepath === b.filepath) {
        return 0;
    }
    return a.filepath < b.filepath ? -1 : 1;
}

// Overlapping positional pathnames walk the same file more than once, so the
// sorted list can hold consecutive copies of a filepath. Reducing it to a set
// keeps each test file imported exactly once by construction instead of
// relying on the ESM module cache to swallow the repeated import().
function dropDuplicateFilepaths(testFiles) {
    return testFiles.filter(({ filepath }, index) => {
        return index === 0 || filepath !== testFiles[index - 1].filepath;
    });
}

function write(msg, callback) {
    process.stdout.write(msg, callback);
}

function writeError(msg, callback) {
    process.stderr.write(msg, callback);
}

main().catch((error) => {
    // Invocation problems are reported on stderr as a plain message so that
    // piping stdout to a file still surfaces the reason the run failed.
    if (error instanceof CommandLineError) {
        const message = error.showUsage
            ? `${ error.message }${ EOL }${ USAGE }${ EOL }`
            : `${ error.message }${ EOL }`;

        writeError(message, () => {
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
