import Logger from '../logger/logger.js';
import ApplicationContext from './application-context.js';
import AppRuntime from './app-runtime.js';
import { assertDeclaredSecrets } from '../config/secrets-manifest.js';
import {
    assert,
    assertFunction,
    isFunction,
    isUndefined,
} from '../assertions/mod.js';


/**
 * @typedef {import('../logger/logger.js').default} Logger
 */

/**
 * @typedef {import('../config/secrets-manifest.js').SecretsManifest} SecretsManifest
 */

/**
 * A lifecycle module. Every hook is optional and receives the
 * ApplicationContext as its first argument.
 * @typedef {Object} PluginModule
 * @property {Function} [register] - Constructs the adapter and registers it. Must not call context.getService().
 * @property {Function} [initialize] - Wires up dependencies between already-registered services.
 * @property {Function} [start] - Begins long-running work, such as a job loop. Also receives `{ onUnexpectedError }`, a function to call with an error the work can't recover from. May be async.
 * @property {Function} [stop] - Ends long-running work. Must be safe when start() never ran or failed. May be async.
 */

/**
 * @typedef {Object} BootedApplication
 * @property {ApplicationContext} appContext
 * @property {Logger} logger
 * @property {function(Object=): Promise<void>} start - Runs the start() hooks. See bootApplication().
 * @property {function(): Promise<void>} stop - Runs the stop() hooks. See bootApplication().
 */

/**
 * Builds the ApplicationContext and runs the plugin lifecycle shared by every
 * entry point: check the declared secrets, construct the runtime and logger,
 * register every plugin before initializing any of them, run the application's
 * own register/initialize hooks last, then finalize the logger.
 *
 * This function is the composition step every platform entry point shares. It
 * does not construct a router or translate requests, because that behavior
 * legitimately differs per platform and stays in the entry point.
 *
 * It is synchronous and calls neither start() nor stop(). It returns them for
 * a server that hosts long-running work to call:
 *
 * - `start({ onUnexpectedError })` calls start() on each plugin that exports
 *   it, in the order of `options.plugins`, then on the app, awaiting each
 *   before the next. When a hook throws or rejects, it stops there and rejects
 *   with that error, without calling stop(); the caller decides what follows.
 *   A second call rejects with an AssertionError.
 * - `stop()` calls stop() on each module that exports it, in reverse: the app
 *   first, then the plugins from last to first. It runs whether or not start()
 *   ran. Each hook is awaited and isolated: a failure is logged and the sweep
 *   continues. A second call does nothing. It does not close services; call
 *   `appContext.close()` afterwards.
 *
 * @param {Object} options
 * @param {Object} options.env - Environment variables, secrets, and platform bindings.
 * @param {Object} options.config - Resolved application configuration.
 * @param {Function} options.LoggerWriter - Platform logger writer constructor.
 * @param {Map<string, PluginModule>} options.plugins - Lifecycle modules, in the order they run.
 * @param {PluginModule} options.app - The application's own lifecycle hooks.
 * @param {SecretsManifest} [options.secrets] - Declared secret names. When given, every name required in config.environment must be set in options.env.
 * @param {string[]} [options.templateHelpers] - Declared template helper names. When given, HyperviewService must be a registered service: after the app's initialize(), it logs a warning for each difference between these names and the helpers registered. A difference never fails boot.
 * @returns {BootedApplication}
 * @throws {OperationalError} When options.secrets is given and a required secret is missing from options.env
 */
export function bootApplication(options) {
    const {
        env,
        config,
        LoggerWriter,
        plugins,
        app,
        secrets,
        templateHelpers,
    } = options ?? {};

    // Check before anything is built, so a deployment that lacks a secret
    // opens no store and writes no log before it fails.
    if (!isUndefined(secrets)) {
        assertDeclaredSecrets(env, secrets, { environment: config.environment });
    }

    // BUILD_ID identifies a single deploy rather than an environment, so it stays
    // an environment variable while the application name and log level do not.
    // An empty BUILD_ID (`BUILD_ID=` in a dotenv file) counts as missing, so the
    // server boots and answers 503 rather than failing.
    const runtime = new AppRuntime({
        build: { id: env.BUILD_ID === '' ? undefined : env.BUILD_ID },
        server: { name: config.name },
    });

    // A project may leave out the LOGGER block or its level. The Logger then
    // defaults to INFO. An invalid level still fails boot.
    const logger = new Logger({
        name: config.name,
        level: config.env.LOGGER?.level,
        writer: new LoggerWriter(),
    });

    const appContext = new ApplicationContext({
        env,
        config,
        runtime,
        logger,
    });

    // Register all plugins before calling initialize() on each, so registry
    // order between plugins is irrelevant.
    for (const plugin of plugins.values()) {
        if (isFunction(plugin?.register)) {
            plugin.register(appContext);
        }
    }

    for (const plugin of plugins.values()) {
        if (isFunction(plugin?.initialize)) {
            plugin.initialize(appContext);
        }
    }

    if (isFunction(app.register)) {
        app.register(appContext);
    }

    if (isFunction(app.initialize)) {
        app.initialize(appContext);
    }

    // Checked after every initialize(), which is where plugins and the app
    // register their helpers.
    if (!isUndefined(templateHelpers)) {
        appContext.getService('HyperviewService').reportTemplateHelperDifferences(templateHelpers);
    }

    // Finalize the logger to prevent creating infinite child loggers.
    // This must be done *after* the plugins have been registered and initialized.
    logger.finalize();

    // Fixed at boot, so start() and stop() see the modules that were registered
    // even if the caller changes its Map afterwards.
    const lifecycleModules = [ ...plugins.entries(), [ 'app', app ] ];

    let hasStarted = false;
    let hasStopped = false;

    async function start(startOptions) {
        const { onUnexpectedError = () => {} } = startOptions ?? {};

        assert(!hasStarted, 'start() has already been called');
        assertFunction(onUnexpectedError, 'start: options.onUnexpectedError');

        hasStarted = true;

        for (const [ , lifecycleModule ] of lifecycleModules) {
            if (isFunction(lifecycleModule?.start)) {
                await lifecycleModule.start(appContext, { onUnexpectedError });
            }
        }
    }

    async function stop() {
        if (hasStopped) {
            return;
        }
        hasStopped = true;

        // Reverse order, so a module stops before the modules it was built on.
        for (const [ name, lifecycleModule ] of lifecycleModules.slice().reverse()) {
            if (!isFunction(lifecycleModule?.stop)) {
                continue;
            }

            try {
                await lifecycleModule.stop(appContext);
            } catch (cause) {
                // Isolate failures: one module that throws must not keep the
                // rest from stopping, or the services from closing afterwards.
                logger.error('error stopping plugin during shutdown', { name }, cause);
            }
        }
    }

    return {
        appContext,
        logger,
        start,
        stop,
    };
}
