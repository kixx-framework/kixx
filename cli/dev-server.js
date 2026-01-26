import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Application from '../lib/application/application.js';
import Logger from '../lib/logger/mod.js';
import DevelopmentServer from '../lib/application/development-server.js';
import HttpRouter from '../lib/http-server/http-router.js';
import HttpRoutesStore from '../lib/http-routes-store/http-routes-store.js';
import FileWatcher from '../lib/lib/file-watcher.js';
import { AssertionError } from '../lib/errors/mod.js';
import {
    isNonEmptyString,
    isNumberNotNaN,
    isFunction,
    assertNumberNotNaN,
    assertNonEmptyString
} from '../lib/assertions/mod.js';

const THIS_FILEPATH = fileURLToPath(import.meta.url);
const CLI_DIR = path.dirname(THIS_FILEPATH);
const DOCS_DIR = path.join(CLI_DIR, 'docs');

const isMainModule = process.argv[1] === THIS_FILEPATH;


// Default delay before restarting server after file changes.
// Prevents rapid restarts when multiple files change in quick succession
// (e.g., during a git checkout or editor save-all operation).
const DEBOUNCE_MS = 300;


const options = {
    help: {
        short: 'h',
        type: 'boolean',
    },
    dir: {
        short: 'd',
        type: 'string',
    },
    config: {
        short: 'c',
        type: 'string',
    },
    secrets: {
        short: 's',
        type: 'string',
    },
    port: {
        short: 'p',
        type: 'string',
    },
    environment: {
        short: 'e',
        type: 'string',
        default: 'development',
    },
};


// Manages the HTTP server child process lifecycle with file watching.
// Forks the same script (dev-server.js) as a child process running startHttpServer(),
// then watches for file changes and restarts the child when source files change.
class ProcessManager {

    #watchDirectory = null;
    #fileIncludePatterns = [];
    #fileExcludePatterns = [];
    #script = THIS_FILEPATH;
    #scriptArgs = [];
    #debounceMs = DEBOUNCE_MS;

    // State flags for coordinating shutdown and restart sequences
    #isStopped = false;
    #isRestarting = false;

    #logger = null;
    #fileWatcher = null;
    #childProcess = null;
    #debounceTimer = null;

    constructor(opts) {
        const {
            logger,
            scriptArgs,
            debounceMs,
            watchDirectory,
            fileIncludePatterns,
            fileExcludePatterns,
        } = opts;

        assertNumberNotNaN(debounceMs);
        assertNonEmptyString(watchDirectory);

        this.#logger = logger;

        this.#watchDirectory = watchDirectory;
        this.#fileIncludePatterns = fileIncludePatterns;
        this.#fileExcludePatterns = fileExcludePatterns;
        this.#scriptArgs = scriptArgs;
        this.#debounceMs = debounceMs;
    }

    start() {
        const directory = this.#watchDirectory;

        this.#fileWatcher = new FileWatcher({
            directory,
            recursive: true,
            includePatterns: this.#fileIncludePatterns,
            excludePatterns: this.#fileExcludePatterns,
        });

        this.#fileWatcher.on('change', (event) => {
            this.#logger.debug('file changed', { file: event.filename });
            this.handleFileChange();
        });

        this.#fileWatcher.on('error', (error) => {
            this.#logger.error('file watcher error', null, error);
        });

        this.#fileWatcher.start();

        this.#logger.info('file watcher started', { directory });

        this.startServer();

        this.#logger.info('use ctrl-c to exit');
    }

    stop(callback) {
        this.#isStopped = true;

        if (this.#debounceTimer) {
            clearTimeout(this.#debounceTimer);
            this.#debounceTimer = null;
        }

        this.#fileWatcher.stop();

        this.killServer(callback);
    }

    // Debounce file changes to batch rapid consecutive changes into a single restart.
    // Each new change resets the timer, so restart only happens after changes settle.
    handleFileChange() {
        if (this.#debounceTimer) {
            clearTimeout(this.#debounceTimer);
        }

        this.#debounceTimer = setTimeout(() => {
            this.#debounceTimer = null;
            this.restartServer();
        }, this.#debounceMs);
    }

    restartServer() {
        this.#isRestarting = true;

        this.killServer(() => {
            this.#isRestarting = false;
            this.startServer();
        });
    }

    startServer() {
        if (this.#childProcess) {
            throw new AssertionError('HTTP development server child process already exists');
        }

        // Maturity time prevents crash loops: if the child process exits before
        // this time, we assume it crashed during startup (e.g., syntax error)
        // and don't auto-restart, avoiding infinite restart cycles.
        const maturityTime = Date.now() + this.#debounceMs;

        // Fork this same script as a child process. When running as a child,
        // isMainModule is true so it executes startHttpServer() instead of main().
        this.#childProcess = fork(this.#script, this.#scriptArgs, {
            stdio: 'inherit',
        });

        this.#childProcess.on('error', (error) => {
            this.#logger.error('error spawning new http server', null, error);
        });

        this.#childProcess.once('spawn', () => {
            this.#logger.info('spawning new http server');
        });

        this.#childProcess.on('exit', (code, signal) => {
            this.#childProcess = null;
            if (!this.#isRestarting) {
                this.#logger.info('child http server exited', { code, signal });
            }
        });

        // Handle automatic restart after unexpected crashes.
        // The 'close' event fires after 'exit' once stdio streams are closed.
        this.#childProcess.on('close', () => {
            // Don't restart if we're in the middle of a deliberate restart
            if (this.#isRestarting) {
                return;
            }
            // Don't restart if the manager has been stopped
            if (this.#isStopped) {
                this.#logger.debug('will not restart http server; development server stopped');
                return;
            }
            // Don't restart if the process crashed before reaching maturity
            // (likely a startup error that would just crash again)
            if (Date.now() < maturityTime) {
                this.#logger.warn('will not restart http server; avoiding circular crash');
                return;
            }

            this.#logger.info('restarting crashed http server');
            this.startServer();
        });
    }

    // Graceful shutdown with force-kill fallback.
    // Sends SIGTERM first, then SIGKILL if the process doesn't exit in time.
    killServer(callback) {
        if (!this.#childProcess) {
            if (isFunction(callback)) {
                callback();
            }
            return;
        }

        const forceKillTimeout = setTimeout(() => {
            if (this.#childProcess && this.#childProcess.exitCode === null) {
                this.#logger.warn('force killing http server child process after timeout');
                this.#childProcess.kill('SIGKILL');
                this.#childProcess = null;
            }
            if (isFunction(callback)) {
                callback();
            }
        }, this.#debounceMs);

        // If the process exits gracefully, cancel the force-kill timer
        this.#childProcess.once('close', () => {
            clearTimeout(forceKillTimeout);
            if (isFunction(callback)) {
                callback();
            }
        });

        this.#childProcess.kill('SIGTERM');
    }
}


// Entry point when run as the parent process (process manager).
// Loads configuration, sets up file watching, and manages HTTP server child process.
export async function main(args) {
    // Parse command line arguments
    const { values } = parseArgs({
        args,
        options,
        strict: true,
        allowPositionals: true,
        allowNegative: true,
    });

    if (values.help) {
        // eslint-disable-next-line no-console
        console.log(readDocFile('dev-server.md'));
        process.exit(0);
        return;
    }

    // Resolve file paths and load application configuration
    const currentWorkingDirectory = process.cwd();

    const applicationDirectory = isNonEmptyString(values.dir) ? values.dir : null;
    const configFilepath = isNonEmptyString(values.config) ? path.resolve(values.config) : null;
    const secretsFilepath = isNonEmptyString(values.secrets) ? path.resolve(values.secrets) : null;
    const environment = values.environment;

    const app = new Application({
        currentWorkingDirectory,
        applicationDirectory,
    });

    const config = await app.loadConfiguration({
        configFilepath,
        secretsFilepath,
        environment,
    });

    // Set a descriptive process title for easier identification of the application process.
    // WARNING: Process names are truncated on some systems (e.g., 15 chars on Ubuntu).
    // eslint-disable-next-line require-atomic-updates
    process.title = config.processName;

    const settings = config.getNamespace('devserver');

    const {
        watchDirectory = app.applicationDirectory,
        watchFileIncludePatterns = [],
        watchFileExcludePatterns = [],
        debounceMs = DEBOUNCE_MS,
        logLevel = 'debug',
        logMode = 'console',
    } = settings;

    const logger = new Logger({
        name: 'devserver',
        level: logLevel,
        mode: logMode,
    });

    // Start the process manager which will fork the HTTP server child process
    const processManager = new ProcessManager({
        logger,
        scriptArgs: args,
        watchDirectory,
        fileIncludePatterns: watchFileIncludePatterns,
        fileExcludePatterns: watchFileExcludePatterns,
        debounceMs,
    });

    processManager.start();

    // Set up graceful shutdown on termination signals
    function handleSignal(signal) {
        logger.info(`received ${ signal }, shutting down`);
        processManager.stop();
    }

    process.on('SIGTERM', () => handleSignal('SIGTERM'));
    process.on('SIGINT', () => handleSignal('SIGINT'));
}

// Entry point when run as a child process (forked by ProcessManager).
// Initializes the full application and starts the HTTP server.
async function startHttpServer(args) {
    const { values } = parseArgs({
        args,
        options,
        strict: true,
        allowPositionals: true,
        allowNegative: true,
    });

    if (values.help) {
        // eslint-disable-next-line no-console
        console.log(readDocFile('app-server.md'));
        process.exit(1);
        return;
    }

    // Resolve paths and initialize the application with plugins
    const currentWorkingDirectory = process.cwd();

    const applicationDirectory = isNonEmptyString(values.dir) ? values.dir : null;
    const configFilepath = isNonEmptyString(values.config) ? path.resolve(values.config) : null;
    const secretsFilepath = isNonEmptyString(values.secrets) ? path.resolve(values.secrets) : null;

    let port = values.port ? parseInt(values.port, 10) : null;

    const environment = values.environment;

    const app = new Application({
        currentWorkingDirectory,
        applicationDirectory,
    });

    const runtime = { server: { name: 'devserver' } };

    const context = await app.initialize({
        runtime,
        environment,
        configFilepath,
        secretsFilepath,
    });

    const { logger } = context;

    // Configure server port (command line overrides config file)
    const serverConfig = context.config.getNamespace('devserver');

    if (!isNumberNotNaN(port)) {
        port = serverConfig.port;
    }

    const router = new HttpRouter();

    router.on('error', ({ error, requestId }) => {
        if (!error.expected && !error.httpError) {
            logger.error('unexpected error', { requestId }, error);
        } else if (error.httpStatusCode >= 500) {
            const { httpStatusCode } = error;
            logger.error('internal server error', { requestId, httpStatusCode }, error);
        }
    });

    const routesStore = new HttpRoutesStore({
        app_directory: context.paths.app_directory,
        routes_directory: context.paths.routes_directory,
    });

    // Create and configure the development server
    const server = new DevelopmentServer(app, router, routesStore, { port });

    server.on('error', (event) => {
        logger.error(event.message, event.info, event.cause);
    });

    server.on('debug', (event) => {
        logger.debug(event.message, event.info, event.cause);
    });

    server.on('info', (event) => {
        logger.info(event.message, event.info, event.cause);
    });

    server.on('warning', (event) => {
        logger.warn(event.message, event.info, event.cause);
    });

    // Validate configs and routes before starting the listener.
    // Catches configuration errors early instead of on first request.
    await server.preload();

    server.startServer();
}

function readDocFile(filename) {
    const filepath = path.join(DOCS_DIR, filename);
    return fs.readFileSync(filepath, { encoding: 'utf8' });
}

// When forked as a child process, isMainModule is true so we run the HTTP server.
// When imported by ProcessManager (parent), main() is called instead.
if (isMainModule) {
    startHttpServer(process.argv.slice(2)).catch((error) => {
        // eslint-disable-next-line no-console
        console.error('Error starting HTTP server:');
        // eslint-disable-next-line no-console
        console.error(error);
    });
}
