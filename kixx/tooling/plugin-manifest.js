import {
    assertNonEmptyString,
    isBoolean,
    isNonEmptyString,
    isPlainObject,
    isString,
    isUndefined,
} from '../assertions/mod.js';
import { ValidationError } from '../errors/mod.js';
import deepFreeze from '../utils/deep-freeze.js';
import deepMerge from '../utils/deep-merge.js';


const PLUGIN_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CORE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SERVICE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9.]*$/;
const CONFIG_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CLASS_NAME_PATTERN = /^[A-Z][A-Za-z0-9_]*$/;
const ROUTE_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

// What the template engine can parse as a helper name.
const TEMPLATE_HELPER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

// A mount is written into generated source and joined to route patterns, so
// it holds no whitespace, quote, or backslash.
const ROUTE_MOUNT_PATTERN = /^\/[^\s"'`\\]*$/;

// Module and directory paths are relative to the manifest's directory. No
// segment may hold a dot, so a path can't climb out of it.
const MODULE_PATH_PATTERN = /^\.\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.js$/;
const DIRECTORY_PATH_PATTERN = /^\.\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/;

// Names a block in the merged environment config, such as CONTENT_STORE.kvNamespace.
const CONFIG_PATH_PATTERN = /^[A-Z][A-Z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/;

const CORE_NAME = 'kixx';
const RESERVED_PLUGIN_NAMES = [ CORE_NAME, 'app' ];

// The platform sets these two variables itself, so no secret may take one.
const RESERVED_SECRET_NAMES = [ 'BUILD_ID', 'ENVIRONMENT' ];

// The `required` value for a secret every environment but development needs.
const REQUIRED_OUTSIDE_DEVELOPMENT = 'outsideDevelopment';

// The secrets template's directives, without the leading `# `.
const RESERVED_SECRET_DESCRIPTIONS = [ '@optional', '@required-outside-development' ];

const TARGETS = [ 'node', 'cloudflare' ];

const MANIFEST_KEYS = [
    'name',
    'version',
    'core',
    'description',
    'dependencies',
    'services',
    'lifecycle',
    'adapters',
    'config',
    'secrets',
    'cloudflare',
    'routes',
    'content',
    'templateHelpers',
    'whenInstalled',
];

const APP_MANIFEST_KEYS = [ 'secrets', 'templateHelpers' ];

const PLUGIN_ONLY_KEYS = [ 'core', 'dependencies', 'whenInstalled' ];
const CORE_ONLY_ADAPTER_KEYS = [ 'loggerWriter', 'serverRequest' ];
const ADAPTER_KEYS = [ 'lifecycle', ...CORE_ONLY_ADAPTER_KEYS ];
const CONFIG_DEFAULTS_KEYS = [ 'all', ...TARGETS ];
const CONTENT_KEYS = [ 'pagesDirectory', 'templatesDirectory', 'staticAssetsDirectory' ];
const WHEN_INSTALLED_KEYS = [ 'lifecycle', 'routes', 'content' ];


/**
 * @typedef {Object} ManifestSecret
 * @property {string} name - Environment variable name
 * @property {(boolean|'outsideDevelopment')} required - False when a deployment may omit the secret; `'outsideDevelopment'` when only development may omit it
 * @property {string} description - One line saying what the secret is for
 */

/**
 * @typedef {Object} ManifestRoute
 * @property {string} module - Module path of the routes module
 * @property {string} [mount] - Pathname pattern the module's routes are nested under
 * @property {string} [name] - Name of the mounted route; present exactly when mount is
 */

/**
 * Content directories, as directory paths. Only the given keys are present.
 * @typedef {Object} ManifestContent
 * @property {string} [pagesDirectory]
 * @property {string} [templatesDirectory]
 * @property {string} [staticAssetsDirectory]
 */

/**
 * @typedef {Object} ManifestAdapter
 * @property {string[]} lifecycle - Module paths of this target's lifecycle modules
 * @property {string} [loggerWriter] - Module path of the logger writer class; core's manifest only
 * @property {string} [serverRequest] - Module path of the server request class; core's manifest only
 */

/**
 * @typedef {Object} ManifestWhenInstalledBlock
 * @property {string[]} lifecycle
 * @property {ManifestRoute[]} routes
 * @property {ManifestContent} content
 */

/**
 * A validated plugin manifest. Every list and object is present, empty when
 * the manifest file left it out, so readers need no fallbacks.
 * @typedef {Object} PluginManifest
 * @property {string} name
 * @property {string} version
 * @property {string} [core] - Oldest core version the plugin works with; absent in core's manifest
 * @property {string} description
 * @property {string[]} dependencies - Names of the plugins this one needs
 * @property {string[]} services - Names the plugin registers with registerService()
 * @property {string[]} lifecycle - Module paths of platform-neutral lifecycle modules, in the order they run
 * @property {{ node: ManifestAdapter, cloudflare: ManifestAdapter }} adapters
 * @property {{ keys: string[], defaults: { all: Object, node: Object, cloudflare: Object } }} config
 * @property {ManifestSecret[]} secrets
 * @property {{ kvNamespaces: Array<{ config: string }>, durableObjects: Array<{ className: string, module: string, config: string }> }} cloudflare
 * @property {ManifestRoute[]} routes
 * @property {ManifestContent} content
 * @property {string[]} templateHelpers - Names of the template helpers the plugin's code registers
 * @property {Object<string, ManifestWhenInstalledBlock>} whenInstalled - Contributions made only when the named plugin is installed
 */

/**
 * @typedef {Object} AppManifest
 * @property {ManifestSecret[]} secrets
 * @property {string[]} templateHelpers - Names of the template helpers the app's code registers
 */


/**
 * Validates the parsed JSON of a plugin manifest (`plugin.json`), or of core's
 * own manifest, and returns a normalized, deeply frozen copy. The input is
 * never mutated.
 *
 * Every problem in the manifest is collected before one error is thrown. Each
 * is pushed onto the error with its path inside the manifest as `source`
 * (`secrets[1].name`, or `''` for the manifest itself), and the error's own
 * message lists them all.
 *
 * @param {*} manifest - The parsed manifest
 * @param {Object} options
 * @param {string} options.file - Path of the manifest file, used in the error message
 * @param {string} [options.directoryName] - Name of the plugin's directory, which a plugin's name must equal
 * @param {boolean} [options.isCore=false] - Applies the rules for core's manifest
 * @returns {PluginManifest}
 * @throws {ValidationError} When the manifest breaks one or more rules
 */
export function validatePluginManifest(manifest, options) {
    const { file, directoryName, isCore = false } = options ?? {};

    assertNonEmptyString(file, 'validatePluginManifest: options.file');

    const problems = [];
    const normalized = readPluginManifest(problems, manifest, { directoryName, isCore });

    if (problems.length > 0) {
        throw createManifestError('plugin', file, problems, validatePluginManifest);
    }

    return deepFreeze(normalized);
}

/**
 * Validates the parsed JSON of an app manifest (`app/app.json`) and returns a
 * normalized, deeply frozen copy. The input is never mutated. Problems are
 * reported the way validatePluginManifest() reports them.
 *
 * @param {*} manifest - The parsed manifest
 * @param {Object} options
 * @param {string} options.file - Path of the manifest file, used in the error message
 * @returns {AppManifest}
 * @throws {ValidationError} When the manifest breaks one or more rules
 */
export function validateAppManifest(manifest, options) {
    const { file } = options ?? {};

    assertNonEmptyString(file, 'validateAppManifest: options.file');

    const problems = [];
    let secrets = [];
    let templateHelpers = [];

    if (isPlainObject(manifest)) {
        reportUnknownKeys(problems, manifest, '', APP_MANIFEST_KEYS);
        secrets = readSecrets(problems, manifest.secrets);
        templateHelpers = readTemplateHelpers(problems, manifest.templateHelpers);
    } else {
        report(problems, '', 'must be a JSON object');
    }

    if (problems.length > 0) {
        throw createManifestError('app', file, problems, validateAppManifest);
    }

    return deepFreeze({ secrets, templateHelpers });
}

function readPluginManifest(problems, manifest, options) {
    const { directoryName, isCore } = options;

    if (!isPlainObject(manifest)) {
        report(problems, '', 'must be a JSON object');
        return null;
    }

    reportUnknownKeys(problems, manifest, '', MANIFEST_KEYS);

    const normalized = {
        name: readName(problems, manifest.name, { directoryName, isCore }),
        version: readString(problems, manifest.version, 'version', VERSION_PATTERN),
    };

    if (isCore) {
        for (const key of PLUGIN_ONLY_KEYS) {
            if (Object.hasOwn(manifest, key)) {
                report(problems, key, 'is not allowed in core\'s manifest');
            }
        }
    } else {
        normalized.core = readString(problems, manifest.core, 'core', CORE_VERSION_PATTERN);
    }

    const ownName = normalized.name;
    const config = readConfig(problems, manifest.config);

    Object.assign(normalized, {
        description: readDescription(problems, manifest.description, 'description'),
        dependencies: isCore ? [] : readPluginNames(problems, manifest.dependencies, 'dependencies', ownName),
        services: readStringList(problems, manifest.services, 'services', SERVICE_NAME_PATTERN),
        lifecycle: readStringList(problems, manifest.lifecycle, 'lifecycle', MODULE_PATH_PATTERN),
        adapters: readAdapters(problems, manifest.adapters, isCore),
        config,
        secrets: readSecrets(problems, manifest.secrets),
        cloudflare: readCloudflare(problems, manifest.cloudflare, config.keys),
        routes: readRoutes(problems, manifest.routes, 'routes'),
        content: readContent(problems, manifest.content, 'content'),
        templateHelpers: readTemplateHelpers(problems, manifest.templateHelpers),
        whenInstalled: isCore ? {} : readWhenInstalled(problems, manifest.whenInstalled, ownName),
    });

    return normalized;
}

function readName(problems, value, options) {
    const { directoryName, isCore } = options;
    const name = readString(problems, value, 'name', PLUGIN_NAME_PATTERN);

    if (name === null) {
        return null;
    }

    if (isCore) {
        if (name !== CORE_NAME) {
            report(problems, 'name', `${ describe(name) } must be "${ CORE_NAME }" in core's manifest`);
        }
    } else if (RESERVED_PLUGIN_NAMES.includes(name)) {
        report(problems, 'name', `${ describe(name) } is reserved and no plugin may use it`);
    } else if (!isUndefined(directoryName) && name !== directoryName) {
        report(problems, 'name', `${ describe(name) } must equal the plugin's directory name ${ describe(directoryName) }`);
    }

    return name;
}

function readDescription(problems, value, path) {
    if (isUndefined(value)) {
        report(problems, path, 'is required');
        return null;
    }

    if (!isNonEmptyString(value) || /[\r\n]/.test(value)) {
        report(problems, path, `${ describe(value) } must be a non-empty string with no line break`);
        return null;
    }

    return value;
}

function readPluginNames(problems, value, path, ownName) {
    const names = readStringList(problems, value, path, PLUGIN_NAME_PATTERN);

    names.forEach((name, index) => {
        if (name === ownName) {
            report(problems, `${ path }[${ index }]`, `${ describe(name) } must not name the plugin itself`);
        }
    });

    return names;
}

function readAdapters(problems, value, isCore) {
    const adapters = {};
    const source = readOptionalObject(problems, value, 'adapters', TARGETS);

    for (const target of TARGETS) {
        const path = `adapters.${ target }`;
        const adapter = readOptionalObject(problems, source[target], path, ADAPTER_KEYS);

        adapters[target] = {
            lifecycle: readStringList(problems, adapter.lifecycle, `${ path }.lifecycle`, MODULE_PATH_PATTERN),
        };

        // Only core provides the logger writer and the server request, so core
        // must name both for both targets and a plugin may name neither.
        for (const key of CORE_ONLY_ADAPTER_KEYS) {
            if (isCore) {
                adapters[target][key] = readString(problems, adapter[key], `${ path }.${ key }`, MODULE_PATH_PATTERN);
            } else if (!isUndefined(adapter[key])) {
                report(problems, `${ path }.${ key }`, 'is allowed only in core\'s manifest');
            }
        }
    }

    return adapters;
}

function readConfig(problems, value) {
    const config = {
        keys: [],
        defaults: { all: {}, node: {}, cloudflare: {} },
    };

    const source = readOptionalObject(problems, value, 'config', [ 'keys', 'defaults' ]);

    config.keys = readStringList(problems, source.keys, 'config.keys', CONFIG_KEY_PATTERN);

    const defaults = readOptionalObject(problems, source.defaults, 'config.defaults', CONFIG_DEFAULTS_KEYS);

    for (const target of CONFIG_DEFAULTS_KEYS) {
        const path = `config.defaults.${ target }`;

        if (isUndefined(defaults[target])) {
            continue;
        }

        if (!isPlainObject(defaults[target])) {
            report(problems, path, 'must be a JSON object');
            continue;
        }

        for (const key of Object.keys(defaults[target])) {
            if (!config.keys.includes(key)) {
                report(problems, `${ path }.${ key }`, 'is not listed in config.keys');
            }
        }

        // Below its top-level keys a defaults object is free-form JSON, and
        // its values are never put in a message: only their paths are.
        reportProtoKeys(problems, defaults[target], path);

        config.defaults[target] = deepMerge({}, defaults[target]);
    }

    return config;
}

// A "__proto__" key parsed from JSON is an ordinary own property, but the
// config merge skips it. Reject it, so a default is never dropped silently.
function reportProtoKeys(problems, value, path) {
    if (Array.isArray(value)) {
        value.forEach((item, index) => reportProtoKeys(problems, item, `${ path }[${ index }]`));
        return;
    }

    if (!isPlainObject(value)) {
        return;
    }

    for (const key of Object.keys(value)) {
        if (key === '__proto__') {
            report(problems, `${ path }.${ key }`, 'is not allowed as a key');
        } else {
            reportProtoKeys(problems, value[key], `${ path }.${ key }`);
        }
    }
}

function readSecrets(problems, value) {
    const names = new Set();

    return readObjectList(problems, value, 'secrets', [ 'name', 'required', 'description' ]).map((entry) => {
        const { item, path } = entry;
        const name = readString(problems, item.name, `${ path }.name`, SECRET_NAME_PATTERN);

        if (name !== null) {
            if (RESERVED_SECRET_NAMES.includes(name)) {
                report(problems, `${ path }.name`, `${ describe(name) } is reserved`);
            } else if (names.has(name)) {
                report(problems, `${ path }.name`, `${ describe(name) } is declared more than once`);
            }

            names.add(name);
        }

        let required = true;

        if (!isUndefined(item.required)) {
            if (isBoolean(item.required) || item.required === REQUIRED_OUTSIDE_DEVELOPMENT) {
                required = item.required;
            } else {
                report(
                    problems,
                    `${ path }.required`,
                    `${ describe(item.required) } must be true, false, or "${ REQUIRED_OUTSIDE_DEVELOPMENT }"`,
                );
            }
        }

        const description = readDescription(problems, item.description, `${ path }.description`);

        // The secrets template writes each description as a comment line, where
        // a directive's text would mark the next entry.
        if (description !== null && RESERVED_SECRET_DESCRIPTIONS.includes(description.trim())) {
            report(problems, `${ path }.description`, `${ describe(description) } is reserved`);
        }

        return { name, required, description };
    });
}

function readCloudflare(problems, value, configKeys) {
    const source = readOptionalObject(problems, value, 'cloudflare', [ 'kvNamespaces', 'durableObjects' ]);
    const configPaths = new Set();
    const classNames = new Set();

    const kvNamespaces = readObjectList(problems, source.kvNamespaces, 'cloudflare.kvNamespaces', [ 'config' ])
        .map((entry) => {
            const { item, path } = entry;

            return { config: readConfigPath(problems, item.config, `${ path }.config`, configKeys, configPaths) };
        });

    const durableObjectKeys = [ 'className', 'module', 'config' ];

    const durableObjects = readObjectList(problems, source.durableObjects, 'cloudflare.durableObjects', durableObjectKeys)
        .map((entry) => {
            const { item, path } = entry;
            const className = readString(problems, item.className, `${ path }.className`, CLASS_NAME_PATTERN);

            if (className !== null) {
                if (classNames.has(className)) {
                    report(problems, `${ path }.className`, `${ describe(className) } is declared more than once`);
                }

                classNames.add(className);
            }

            return {
                className,
                module: readString(problems, item.module, `${ path }.module`, MODULE_PATH_PATTERN),
                config: readConfigPath(problems, item.config, `${ path }.config`, configKeys, configPaths),
            };
        });

    return { kvNamespaces, durableObjects };
}

function readConfigPath(problems, value, path, configKeys, usedConfigPaths) {
    const configPath = readString(problems, value, path, CONFIG_PATH_PATTERN);

    if (configPath === null) {
        return null;
    }

    if (!configKeys.includes(configPath.split('.')[0])) {
        report(problems, path, `${ describe(configPath) } must begin with a key listed in config.keys`);
    } else if (usedConfigPaths.has(configPath)) {
        report(problems, path, `${ describe(configPath) } is used more than once`);
    }

    usedConfigPaths.add(configPath);

    return configPath;
}

function readRoutes(problems, value, path) {
    return readObjectList(problems, value, path, [ 'module', 'mount', 'name' ]).map((entry) => {
        const { item, path: itemPath } = entry;

        const route = {
            module: readString(problems, item.module, `${ itemPath }.module`, MODULE_PATH_PATTERN),
        };

        // A name identifies the mounted route, so it comes with a mount or not at all.
        if (!isUndefined(item.mount)) {
            route.mount = readString(problems, item.mount, `${ itemPath }.mount`, ROUTE_MOUNT_PATTERN);
            route.name = readString(problems, item.name, `${ itemPath }.name`, ROUTE_NAME_PATTERN);
        } else if (!isUndefined(item.name)) {
            report(problems, `${ itemPath }.name`, `${ describe(item.name) } is allowed only with a mount`);
        }

        return route;
    });
}

function readContent(problems, value, path) {
    const content = {};

    if (isUndefined(value)) {
        return content;
    }

    const source = readOptionalObject(problems, value, path, CONTENT_KEYS);

    for (const key of CONTENT_KEYS) {
        if (!isUndefined(source[key])) {
            content[key] = readString(problems, source[key], `${ path }.${ key }`, DIRECTORY_PATH_PATTERN);
        }
    }

    if (isPlainObject(value) && Object.keys(content).length === 0) {
        report(problems, path, `must hold at least one of ${ CONTENT_KEYS.join(', ') }`);
    }

    return content;
}

function readTemplateHelpers(problems, value) {
    return readStringList(problems, value, 'templateHelpers', TEMPLATE_HELPER_NAME_PATTERN);
}

function readWhenInstalled(problems, value, ownName) {
    const whenInstalled = {};

    if (isUndefined(value)) {
        return whenInstalled;
    }

    if (!isPlainObject(value)) {
        report(problems, 'whenInstalled', 'must be a JSON object');
        return whenInstalled;
    }

    for (const pluginName of Object.keys(value)) {
        const path = `whenInstalled.${ pluginName }`;
        const block = value[pluginName];

        if (!PLUGIN_NAME_PATTERN.test(pluginName)) {
            report(problems, path, `must be keyed by a plugin name that matches ${ PLUGIN_NAME_PATTERN }`);
            continue;
        }

        if (pluginName === ownName) {
            report(problems, path, 'must not name the plugin itself');
            continue;
        }

        if (!isPlainObject(block)) {
            report(problems, path, 'must be a JSON object');
            continue;
        }

        reportUnknownKeys(problems, block, path, WHEN_INSTALLED_KEYS);

        if (!WHEN_INSTALLED_KEYS.some((key) => !isUndefined(block[key]))) {
            report(problems, path, `must hold at least one of ${ WHEN_INSTALLED_KEYS.join(', ') }`);
        }

        whenInstalled[pluginName] = {
            lifecycle: readStringList(problems, block.lifecycle, `${ path }.lifecycle`, MODULE_PATH_PATTERN),
            routes: readRoutes(problems, block.routes, `${ path }.routes`),
            content: readContent(problems, block.content, `${ path }.content`),
        };
    }

    return whenInstalled;
}

// Returns the value, or null after reporting why it can't be used.
function readString(problems, value, path, pattern) {
    if (isUndefined(value)) {
        report(problems, path, 'is required');
        return null;
    }

    if (!isString(value) || !pattern.test(value)) {
        report(problems, path, `${ describe(value) } must match ${ pattern }`);
        return null;
    }

    return value;
}

// Returns the list's valid, distinct strings. An absent list is empty.
function readStringList(problems, value, path, pattern) {
    const list = [];

    if (isUndefined(value)) {
        return list;
    }

    if (!Array.isArray(value)) {
        report(problems, path, 'must be a JSON array');
        return list;
    }

    value.forEach((item, index) => {
        const itemPath = `${ path }[${ index }]`;

        if (!isString(item) || !pattern.test(item)) {
            report(problems, itemPath, `${ describe(item) } must match ${ pattern }`);
        } else if (list.includes(item)) {
            report(problems, itemPath, `${ describe(item) } is listed more than once`);
        } else {
            list.push(item);
        }
    });

    return list;
}

// Returns the list's objects, each with its path. An absent list is empty.
function readObjectList(problems, value, path, allowedKeys) {
    const list = [];

    if (isUndefined(value)) {
        return list;
    }

    if (!Array.isArray(value)) {
        report(problems, path, 'must be a JSON array');
        return list;
    }

    value.forEach((item, index) => {
        const itemPath = `${ path }[${ index }]`;

        if (isPlainObject(item)) {
            reportUnknownKeys(problems, item, itemPath, allowedKeys);
            list.push({ item, path: itemPath });
        } else {
            report(problems, itemPath, 'must be a JSON object');
        }
    });

    return list;
}

// Returns the object, or an empty one when it is absent or not an object.
function readOptionalObject(problems, value, path, allowedKeys) {
    if (isUndefined(value)) {
        return {};
    }

    if (!isPlainObject(value)) {
        report(problems, path, 'must be a JSON object');
        return {};
    }

    reportUnknownKeys(problems, value, path, allowedKeys);

    return value;
}

// A misspelled key would silently drop what it declares, such as a secret
// from the boot check, so an unknown key is a problem and never ignored.
function reportUnknownKeys(problems, object, path, allowedKeys) {
    for (const key of Object.keys(object)) {
        if (!allowedKeys.includes(key)) {
            const source = path ? `${ path }.${ key }` : key;

            problems.push({ source, message: `"${ source }" is not a manifest key` });
        }
    }
}

function report(problems, source, detail) {
    problems.push({
        source,
        message: source ? `${ source } ${ detail }` : detail,
    });
}

// Names an offending value in a message. Only a string or a primitive is
// quoted; an object or an array is named by its kind.
function describe(value) {
    if (isString(value)) {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return 'an array';
    }

    if (isPlainObject(value)) {
        return 'an object';
    }

    return String(value);
}

function createManifestError(kind, file, problems, sourceFunction) {
    const messages = problems.map((problem) => problem.message);

    const error = new ValidationError(
        `Invalid ${ kind } manifest ${ file }: ${ messages.join('; ') }`,
        {},
        sourceFunction,
    );

    for (const problem of problems) {
        error.push(problem.message, problem.source);
    }

    return error;
}
