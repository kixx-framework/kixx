/**
 * Integration test runner for test-app/.
 *
 * Runs the suite in test-app/test/ against a real target: a test app that is
 * already running on this machine, or one that is already deployed. The
 * runner starts nothing and deploys nothing; it only points the tests at the
 * target's base URL.
 *
 * It uses the repository's devDependencies, so run `npm install` once at the
 * repository root. The unit test runner (run-tests.js at the repository root)
 * never collects this suite.
 *
 * Usage: node test-app/run-tests.js [--skip <path>]
 *     [--base-url <url> | --local | --cloudflare | --nodejs] [pathname ...]
 */
import process from 'node:process';
import util from 'node:util';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EOL } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runTests } from 'kixx-test';
import { isNonEmptyString } from 'kixx-assert';


const USAGE = 'Usage: node test-app/run-tests.js [--skip <path>] ' +
    '[--base-url <url> | --local | --cloudflare | --nodejs] [pathname ...]';

const ROOT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

const TEST_ROOT = path.join(ROOT_DIRECTORY, 'test');

// Matches the *.test.js project naming convention. The leading `\.` keeps a
// module like `latest.js` from being collected as a test file.
const TEST_FILE_PATTERN = /\.test\.js$/;

// Integration tests drive a running application over the network, so the
// kixx-test default of 1000ms is unusable for them. This acts as a ceiling and
// not a floor: kixx-test resolves the runner option in preference to a block's
// own timeout, so an individual describe block cannot raise it above this value.
const INTEGRATION_TEST_TIMEOUT = 10000;

// Every option that chooses the target. At most one may be used.
const TARGET_OPTION_NAMES = [
    'base-url',
    'local',
    'cloudflare',
    'nodejs',
];

// These URLs are carried over from v6. Each one is confirmed when a test app
// is first deployed to that target. The local target is the test app running
// on this machine with production settings, not in development mode.
const NAMED_TARGET_BASE_URLS = new Map([
    [ 'local', 'http://localhost:2026/' ],
    [ 'cloudflare', 'https://kixx-test-app.kixx.workers.dev/' ],
    [ 'nodejs', 'https://nodejs.kixx-testing.dev/' ],
]);


// Signals an invocation problem the user can correct: a bad flag, a pathname
// outside the suite, or a missing target. Reported as a message on stderr
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

    configureTargetEnvironment(args);

    // The root anchors every containment check below, so confirm it exists
    // before validating any pathname against it.
    await assertTestRootExists(TEST_ROOT);

    const testPaths = args.positionals.map((p) => path.resolve(p));
    const skipPaths = (args.values.skip || []).map((p) => path.resolve(p));

    // Positional and --skip pathnames are both constrained to the suite root, so
    // a pathname outside it, such as the unit suite, fails loudly instead of
    // importing tests that do not belong to this suite.
    assertPathsInTestRoot(testPaths, TEST_ROOT, 'Test');
    assertPathsInTestRoot(skipPaths, TEST_ROOT, 'Skip');

    // Pathnames above are resolved from the caller's directory. Once they are,
    // pin the working directory to test-app/ so tests which read fixtures by
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
        // Load all test files from the full, nested suite root.
        testFiles = await readTestFilesFromDirectory(TEST_ROOT, skipPaths);
    }

    // Sorting the fully collected list, rather than each directory during the
    // walk, makes import order a pure function of the set of selected files:
    // readdir() order and the order of the positional arguments cannot reach
    // it. Deduplication depends on this sort to put copies side by side.
    testFiles.sort(compareFilepaths);
    testFiles = dropDuplicateFilepaths(testFiles);

    // An empty selection must fail, so a run never reports a missing suite as
    // a passing one.
    if (testFiles.length === 0) {
        const searched = testPaths.length > 0 ? testPaths.join(', ') : TEST_ROOT;
        throw new CommandLineError(`No test files found under ${ searched }`, false);
    }

    for (const file of testFiles) {
        // eslint-disable-next-line no-await-in-loop
        await dynamicallyImportFile(file);
    }

    const emitter = runTests({ timeout: INTEGRATION_TEST_TIMEOUT });

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
            // typo like --cloudflair would be ignored and the run would fall
            // back to whatever target the environment names.
            strict: true,
            allowPositionals: true,
            tokens: true,
            options: {
                skip: { type: 'string', multiple: true },
                'base-url': { type: 'string' },
                local: { type: 'boolean' },
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

// Resolves the target from the command line and the environment, and leaves
// it in process.env for the tests. The deploy key is not handled here: tests
// read it from the environment themselves, and it has no command line flag,
// because a secret on the command line leaks into shell history and process
// listings.
function configureTargetEnvironment(args) {
    const suppliedOptionNames = args.tokens
        .filter(({ kind, name }) => {
            return kind === 'option' && TARGET_OPTION_NAMES.includes(name);
        })
        .map(({ name }) => name);

    assertOptionsNotRepeated(suppliedOptionNames);

    const suppliedOptions = new Set(suppliedOptionNames);

    assertTargetOptionsDoNotConflict(suppliedOptions);
    assertBaseUrlOptionIsNotEmpty(args.values, suppliedOptions);
    applyTargetEnvironmentOverrides(args.values, suppliedOptions);
    assertBaseUrlIsSet();
    assertBaseUrlIsValid(process.env.INTEGRATION_TESTS_BASE_URL);
}

function assertOptionsNotRepeated(optionNames) {
    const seen = new Set();

    for (const optionName of optionNames) {
        if (seen.has(optionName)) {
            throw new CommandLineError(
                `Integration test configuration option --${ optionName } cannot be repeated.`,
                true,
            );
        }
        seen.add(optionName);
    }
}

function assertTargetOptionsDoNotConflict(suppliedOptions) {
    if (suppliedOptions.size > 1) {
        throw new CommandLineError(
            'Only one base URL option may be used: ' +
                '--base-url, --local, --cloudflare, or --nodejs.',
            true,
        );
    }
}

function assertBaseUrlOptionIsNotEmpty(values, suppliedOptions) {
    if (suppliedOptions.has('base-url') && values['base-url'] === '') {
        throw new CommandLineError(
            'Integration test configuration option --base-url cannot be empty.',
            true,
        );
    }
}

function applyTargetEnvironmentOverrides(values, suppliedOptions) {
    // This process-local marker describes the explicit CLI preset. Clear any
    // inherited value so --base-url cannot accidentally select preset behavior.
    delete process.env.INTEGRATION_TESTS_TARGET;

    if (suppliedOptions.has('base-url')) {
        process.env.INTEGRATION_TESTS_BASE_URL = values['base-url'];
    }

    for (const [ optionName, baseUrl ] of NAMED_TARGET_BASE_URLS) {
        if (suppliedOptions.has(optionName)) {
            process.env.INTEGRATION_TESTS_BASE_URL = baseUrl;
            process.env.INTEGRATION_TESTS_TARGET = optionName;
        }
    }
}

function assertBaseUrlIsSet() {
    if (!isNonEmptyString(process.env.INTEGRATION_TESTS_BASE_URL)) {
        throw new CommandLineError(
            'Missing required integration test environment variable: INTEGRATION_TESTS_BASE_URL.',
            true,
        );
    }
}

function assertBaseUrlIsValid(baseUrl) {
    if (baseUrl.trim() !== baseUrl) {
        throw new CommandLineError(
            'INTEGRATION_TESTS_BASE_URL cannot have leading or trailing whitespace.',
            true,
        );
    }

    let url;
    try {
        url = new URL(baseUrl);
    } catch {
        throw new CommandLineError(
            'INTEGRATION_TESTS_BASE_URL must be a valid absolute HTTP(S) URL.',
            true,
        );
    }

    if (![ 'http:', 'https:' ].includes(url.protocol) || !isNonEmptyString(url.hostname)) {
        throw new CommandLineError(
            'INTEGRATION_TESTS_BASE_URL must be a valid absolute HTTP(S) URL.',
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
