import { assert, assertArray, isPlainObject } from '../assertions/mod.js';
import { ValidationError } from '../errors/mod.js';
import deepFreeze from '../utils/deep-freeze.js';
import deepMerge from '../utils/deep-merge.js';


const TARGETS = [ 'node', 'cloudflare' ];

// The owner name of what the app manifest declares.
const APP_OWNER = 'app';


/**
 * @typedef {import('./plugin-manifest.js').PluginManifest} PluginManifest
 */

/**
 * @typedef {import('./plugin-manifest.js').AppManifest} AppManifest
 */

/**
 * @typedef {import('./plugin-manifest.js').ManifestContent} ManifestContent
 */

/**
 * @typedef {import('./plugin-manifest.js').ManifestRoute} ManifestRoute
 */

/**
 * A manifest as it applies to this installation: the validated manifest with
 * every `whenInstalled` block whose plugin is installed merged in.
 * @typedef {PluginManifest} EffectiveManifest
 * @property {string[]} lifecycle - The manifest's own lifecycle modules, then those of each merged block, without repeats
 * @property {ManifestRoute[]} routes - The manifest's own routes, then those of each merged block
 * @property {ManifestContent[]} contentRoots - The manifest's own content when it has any, then the content of each merged block
 */

/**
 * @typedef {Object} InstallationEntry
 * @property {string} name - `kixx` for core, or the plugin's name
 * @property {EffectiveManifest} manifest
 */

/**
 * What one target runs.
 * @typedef {Object} InstallationTarget
 * @property {Array<{ owner: string, module: string }>} lifecycle - Lifecycle modules in the order they run; `module` is relative to the owner's directory
 * @property {string} loggerWriter - Core's logger writer module for this target, relative to core's directory
 * @property {string} serverRequest - Core's server request module for this target, relative to core's directory
 * @property {Object} configDefaults - Every manifest's config defaults for this target, with `all` under the target's own
 */

/**
 * The installed manifests resolved into one ordered model. `owner` is `kixx`,
 * a plugin's name, or `app`. Every list is in entry order: core, then the
 * plugins with each dependency before its dependents and ties broken by name,
 * then (for secrets) the app. Module and directory paths are as their manifest
 * wrote them, relative to the owner's directory.
 * @typedef {Object} Installation
 * @property {InstallationEntry[]} entries - Core first, then the plugins in order
 * @property {{ node: InstallationTarget, cloudflare: InstallationTarget }} targets
 * @property {Array<{ owner: string, name: string, required: (boolean|'outsideDevelopment'), description: string }>} secrets
 * @property {Array<{ owner: string, module: string, mount: (string|undefined), name: (string|undefined) }>} routes - `mount` and `name` are present together or not at all
 * @property {Array<{ owner: string, pagesDirectory: (string|undefined), templatesDirectory: (string|undefined), staticAssetsDirectory: (string|undefined) }>} contentRoots - Only the directories a root declares are present
 * @property {Array<{ owner: string, className: string, module: string, config: string }>} durableObjects - Durable Object classes; `config` is the config path of the block that describes the binding
 * @property {Array<{ owner: string, config: string }>} kvNamespaces - KV namespaces; `config` is the config path of the block that describes the namespace
 * @property {string[]} templateHelpers - Every template helper name core, the plugins, and the app declare, without repeats, sorted by code unit
 */


/**
 * Resolves core's manifest, the installed plugins' manifests, and the app
 * manifest into the one ordered model the registry generator reads. It is
 * pure: the same manifests, given in any order, resolve to the same model.
 *
 * Every problem between the manifests is collected before one error is
 * thrown: a dependency that is not installed, a dependency cycle, a plugin
 * that needs another core version, and a service, config key, secret, Durable
 * Object class, route mount, or route name that is declared twice.
 *
 * @param {Object} options
 * @param {PluginManifest} options.core - Core's manifest, as validatePluginManifest() returned it
 * @param {PluginManifest[]} options.plugins - The installed plugins' manifests, as validatePluginManifest() returned them, in any order
 * @param {AppManifest} [options.app] - The app manifest, as validateAppManifest() returned it
 * @returns {Installation} The model, deeply frozen
 * @throws {ValidationError} When the manifests don't fit together
 */
export function resolveInstallation(options) {
    const { core, plugins, app } = options ?? {};

    assert(isPlainObject(core), 'resolveInstallation: options.core must be a validated manifest');
    assertArray(plugins, 'resolveInstallation: options.plugins');

    const problems = [];

    // Sorted before anything else, so the input order never reaches the model.
    const sortedPlugins = plugins.slice().sort(compareByName);
    const installedNames = new Set(sortedPlugins.map((manifest) => manifest.name));

    reportMissingDependencies(problems, sortedPlugins, installedNames);

    const orderedPlugins = orderPlugins(problems, sortedPlugins, installedNames);

    reportIncompatiblePlugins(problems, sortedPlugins, core.version);

    const entries = [ core, ...orderedPlugins ].map((manifest) => {
        return { name: manifest.name, manifest: createEffectiveManifest(manifest, installedNames) };
    });

    const installation = {
        entries,
        targets: {},
        secrets: collect(entries, (manifest) => manifest.secrets),
        routes: collect(entries, (manifest) => manifest.routes),
        contentRoots: collect(entries, (manifest) => manifest.contentRoots),
        durableObjects: collect(entries, (manifest) => manifest.cloudflare.durableObjects),
        kvNamespaces: collect(entries, (manifest) => manifest.cloudflare.kvNamespaces),
        templateHelpers: collectTemplateHelpers(entries, app),
    };

    for (const target of TARGETS) {
        installation.targets[target] = createTarget(entries, core, target);
    }

    for (const secret of app?.secrets ?? []) {
        installation.secrets.push({ owner: APP_OWNER, ...secret });
    }

    const mountedRoutes = installation.routes.filter((route) => Object.hasOwn(route, 'mount'));

    reportShared(problems, 'service', 'is provided by', collectValues(entries, (manifest) => manifest.services));
    reportShared(problems, 'config key', 'is owned by', collectValues(entries, (manifest) => manifest.config.keys));
    reportShared(problems, 'secret', 'is declared by', installation.secrets.map(toClaim('name')));
    reportShared(problems, 'Durable Object class', 'is declared by', installation.durableObjects.map(toClaim('className')));
    reportShared(problems, 'route mount', 'is used by', mountedRoutes.map(toClaim('mount')));
    reportShared(problems, 'route name', 'is used by', mountedRoutes.map(toClaim('name')));

    if (problems.length > 0) {
        const error = new ValidationError(
            `Invalid plugin installation: ${ problems.join('; ') }`,
            {},
            resolveInstallation,
        );

        for (const problem of problems) {
            error.push(problem, '');
        }

        throw error;
    }

    return deepFreeze(installation);
}

// Plain code unit order, not locale order, so every machine sorts alike.
function compareByName(a, b) {
    if (a.name < b.name) {
        return -1;
    }

    return a.name > b.name ? 1 : 0;
}

function reportMissingDependencies(problems, plugins, installedNames) {
    for (const manifest of plugins) {
        for (const dependency of manifest.dependencies) {
            if (!installedNames.has(dependency)) {
                problems.push(`plugin "${ manifest.name }" depends on "${ dependency }", which is not installed`);
            }
        }
    }
}

// Repeatedly takes the plugin, first by name, whose dependencies are all placed.
function orderPlugins(problems, sortedPlugins, installedNames) {
    const placed = new Set();
    const ordered = [];
    let remaining = sortedPlugins;

    while (remaining.length > 0) {
        // A dependency that isn't installed is already a problem of its own.
        // It doesn't hold its plugin back here, or it would read as a cycle too.
        const next = remaining.find((manifest) => {
            return manifest.dependencies.every((name) => placed.has(name) || !installedNames.has(name));
        });

        if (!next) {
            break;
        }

        placed.add(next.name);
        ordered.push(next);
        remaining = remaining.filter((manifest) => manifest !== next);
    }

    if (remaining.length > 0) {
        const names = findCycleMembers(remaining).map((manifest) => manifest.name);

        problems.push(`plugins ${ joinNames(names) } depend on each other in a cycle`);
    }

    // The plugins that could not be placed still go into the model's lists,
    // so every other problem among them is reported in the same error.
    return ordered.concat(remaining);
}

// The plugins that can't be placed are those in a cycle and those that depend
// on one. Dropping every plugin that no other one depends on, until none is
// left to drop, leaves the cycle itself.
function findCycleMembers(unplaced) {
    let members = unplaced;

    for (;;) {
        const needed = new Set(members.flatMap((manifest) => manifest.dependencies));
        const kept = members.filter((manifest) => needed.has(manifest.name));

        if (kept.length === members.length) {
            return members;
        }

        members = kept;
    }
}

// A plugin's `core` is the oldest core version it works with. It works with
// that version and every later one of the same major version. A prerelease
// tag on core's version is ignored.
function reportIncompatiblePlugins(problems, plugins, coreVersion) {
    const actual = parseVersion(coreVersion);

    for (const manifest of plugins) {
        const needed = parseVersion(manifest.core);
        const isSameMajor = needed[0] === actual[0];

        if (!isSameMajor || compareVersions(needed, actual) > 0) {
            problems.push(
                `plugin "${ manifest.name }" needs core ${ manifest.core } or a later ${ needed[0] }.x version, but core is ${ coreVersion }`,
            );
        }
    }
}

function parseVersion(version) {
    return version.split('-')[0].split('.').map((part) => Number.parseInt(part, 10));
}

function compareVersions(a, b) {
    for (let index = 0; index < 3; index += 1) {
        if (a[index] !== b[index]) {
            return a[index] - b[index];
        }
    }

    return 0;
}

function createEffectiveManifest(manifest, installedNames) {
    const lifecycle = manifest.lifecycle.slice();
    const routes = manifest.routes.slice();
    const contentRoots = hasKeys(manifest.content) ? [ manifest.content ] : [];

    // Blocks are merged in name order, so the manifest's key order never
    // reaches the model.
    for (const pluginName of Object.keys(manifest.whenInstalled).sort()) {
        if (!installedNames.has(pluginName)) {
            continue;
        }

        const block = manifest.whenInstalled[pluginName];

        lifecycle.push(...block.lifecycle);
        routes.push(...block.routes);

        if (hasKeys(block.content)) {
            contentRoots.push(block.content);
        }
    }

    return {
        ...manifest,
        // A block may list a module the plugin already runs. It runs once.
        lifecycle: Array.from(new Set(lifecycle)),
        routes,
        contentRoots,
    };
}

function createTarget(entries, core, target) {
    const lifecycle = [];
    const configDefaults = {};

    for (const { name, manifest } of entries) {
        // The platform-neutral modules run before the target's own.
        const modules = new Set(manifest.lifecycle.concat(manifest.adapters[target].lifecycle));

        for (const module of modules) {
            lifecycle.push({ owner: name, module });
        }

        // No two manifests own the same config key, so merging them one after
        // another gives each key its own manifest's defaults.
        deepMerge(configDefaults, manifest.config.defaults.all, manifest.config.defaults[target]);
    }

    return {
        lifecycle,
        loggerWriter: core.adapters[target].loggerWriter,
        serverRequest: core.adapters[target].serverRequest,
        configDefaults,
    };
}

// Gathers one kind of record from every entry, in entry order, each with its owner.
function collect(entries, getRecords) {
    return entries.flatMap((entry) => {
        return getRecords(entry.manifest).map((record) => ({ owner: entry.name, ...record }));
    });
}

// Several owners may declare one helper name, because registering a helper
// replaces an earlier one of the same name. So the names are a set, and no
// owner is kept.
function collectTemplateHelpers(entries, app) {
    const names = new Set(entries.flatMap((entry) => entry.manifest.templateHelpers));

    for (const name of app?.templateHelpers ?? []) {
        names.add(name);
    }

    // The default sort is by code unit, so every machine sorts alike.
    return Array.from(names).sort();
}

function collectValues(entries, getValues) {
    return entries.flatMap((entry) => {
        return getValues(entry.manifest).map((value) => ({ owner: entry.name, value }));
    });
}

function toClaim(key) {
    return (record) => ({ owner: record.owner, value: record[key] });
}

// Reports each value that is claimed more than once, naming who claims it.
function reportShared(problems, label, verb, claims) {
    const ownersByValue = new Map();

    for (const { owner, value } of claims) {
        if (!ownersByValue.has(value)) {
            ownersByValue.set(value, []);
        }

        ownersByValue.get(value).push(owner === APP_OWNER ? 'the app' : owner);
    }

    for (const [ value, owners ] of ownersByValue) {
        if (owners.length < 2) {
            continue;
        }

        const distinctOwners = Array.from(new Set(owners));

        const who = distinctOwners.length === 1
            ? `${ distinctOwners[0] } more than once`
            : joinNames(distinctOwners);

        problems.push(`${ label } "${ value }" ${ verb } ${ who }`);
    }
}

function joinNames(names) {
    if (names.length < 2) {
        return names.join('');
    }

    return `${ names.slice(0, -1).join(', ') } and ${ names[names.length - 1] }`;
}

function hasKeys(object) {
    return Object.keys(object).length > 0;
}
