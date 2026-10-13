/**
 * Rebuilds test-app/ from lib/ for local runs.
 *
 * Validates test-app's env, secrets, .kixx/, and config context files against
 * lib's manifests and examples, then renders both config templates in memory.
 * Only when every check and render passes does it wipe test-app/ (keeping its
 * config and secrets), copy lib/ into it, and write the hydrated configs.
 *
 * Usage: node tools/build-test-app.js
 */
import process from 'node:process';
import util from 'node:util';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as templating from '../lib/kixx/vendor/templating/mod.js';
import { parseSecretsManifest } from '../lib/kixx/config/secrets-manifest.js';
import { parseJsonc } from '../lib/kixx/config/parse-jsonc.js';


const USAGE = 'Usage: node tools/build-test-app.js (takes no arguments)';

// Resolve from the script location, never cwd, so a copy of the tool acts on
// its own sibling lib/ and test-app/.
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB_DIRECTORY = path.join(REPO_ROOT, 'lib');
const TEST_APP_DIRECTORY = path.join(REPO_ROOT, 'test-app');

const ENV_FILES = [ '.env.development', '.env.production' ];
const SECRETS_FILES = [ '.env.development.secrets', '.env.production.secrets' ];

const KIXX_FILES = [
    { example: '.kixx/example.config.json', target: '.kixx/config.json' },
    { example: '.kixx/example.secrets.json', target: '.kixx/secrets.json' },
];

const CONFIGS = [
    {
        context: 'node-config-test-context.json',
        template: 'node-config.jsonc.template',
        output: 'node-config.jsonc',
    },
    {
        context: 'cloudflare-config-test-context.json',
        template: 'cloudflare-config.jsonc.template',
        output: 'cloudflare-config.jsonc',
    },
];

// Top-level test-app/ entries that survive the wipe: hand-authored config and secrets.
const KEEP_NAMES = new Set([
    'README.md',
    '.gitignore',
    'node-config-test-context.json',
    'cloudflare-config-test-context.json',
    '.kixx',
]);

// Top-level lib/ entries never copied. Contexts and .gitignore would clobber
// test-app's own; templates and checked-in configs are replaced by the
// hydrated output; the rest are dev-only or deploy-tool artifacts.
const EXCLUDED_NAMES = new Set([
    '.kixx',
    'test',
    '.gitignore',
    'cloudflare-config.jsonc',
    'node-config.jsonc',
    'package-lock.json',
    'run-linter.js',
    'run-tests.js',
    'eslint.config.js',
    'node_modules',
    'example.env',
    'cloudflare-config.generated.js',
]);


async function main() {
    if (process.argv.length > 2) {
        // Reject every argument so a mistyped flag like --dry-run never falls through to a wipe.
        process.stderr.write(`${ USAGE }\n`);
        process.exitCode = 1;
        return;
    }

    // Phase 1: validate. Collect every problem before reporting.
    const problems = await validate();

    if (problems.length > 0) {
        reportProblems(problems);
        process.exitCode = 1;
        return;
    }

    // Phase 2: render both templates in memory. Nothing is written yet.
    const rendered = [];
    const renderProblems = [];

    for (const config of CONFIGS) {
        try {
            const context = JSON.parse(await readText(TEST_APP_DIRECTORY, config.context));
            const output = renderTemplate(config.template, await readText(LIB_DIRECTORY, config.template), context);
            parseJsonc(output);
            rendered.push({ filename: config.output, output });
        } catch (error) {
            renderProblems.push(`${ config.template }: ${ errorChainMessage(error) }`);
        }
    }

    if (renderProblems.length > 0) {
        reportProblems(renderProblems);
        process.exitCode = 1;
        return;
    }

    // Phases 3 to 5 are not atomic. An interrupted run leaves test-app/ partial
    // and rerunning repairs it. Preserved files are never written, so config and
    // secrets cannot be damaged.

    // Phase 3: wipe.
    for (const name of await fsp.readdir(TEST_APP_DIRECTORY)) {
        if (!isKeptName(name)) {
            await fsp.rm(path.join(TEST_APP_DIRECTORY, name), { recursive: true, force: true });
        }
    }

    // Phase 4: copy.
    await fsp.cp(LIB_DIRECTORY, TEST_APP_DIRECTORY, { recursive: true, filter: isCopied });

    // Phase 5: write hydrated configs.
    for (const { filename, output } of rendered) {
        await fsp.writeFile(path.join(TEST_APP_DIRECTORY, filename), output);
    }

    process.stdout.write('Rebuilt test-app/ and wrote node-config.jsonc and cloudflare-config.jsonc\n');
}

async function validate() {
    const problems = [];

    // Commented `# KEY=` lines are skipped by parseEnv, so they stay optional.
    const requiredEnvKeys = Object.keys(util.parseEnv(await readText(LIB_DIRECTORY, 'example.env')));

    for (const filename of ENV_FILES) {
        const label = testAppLabel(filename);
        const text = await readOptionalText(TEST_APP_DIRECTORY, filename);

        if (text === null) {
            problems.push(`${ label }: missing`);
        } else {
            const keys = Object.keys(util.parseEnv(text));

            for (const key of requiredEnvKeys.filter((k) => !keys.includes(k))) {
                problems.push(`${ label }: missing key ${ key }`);
            }
        }
    }

    // A manifest parse failure is a programmer error in a checked-in file, so let it throw.
    const { required: requiredSecrets } = parseSecretsManifest(await readText(LIB_DIRECTORY, 'example.env.secrets'));

    for (const filename of SECRETS_FILES) {
        const label = testAppLabel(filename);
        const text = await readOptionalText(TEST_APP_DIRECTORY, filename);

        if (text === null) {
            problems.push(`${ label }: missing`);
        } else {
            // Only names are compared; secret values are never printed.
            const names = Object.keys(util.parseEnv(text));

            for (const name of requiredSecrets.filter((n) => !names.includes(n))) {
                problems.push(`${ label }: missing secret ${ name }`);
            }
        }
    }

    for (const { example, target } of KIXX_FILES) {
        const label = testAppLabel(target);
        const expected = JSON.parse(await readText(LIB_DIRECTORY, example));
        const result = await readOptionalJson(TEST_APP_DIRECTORY, target);

        if (result.problem) {
            problems.push(`${ label }: ${ result.problem }`);
        } else {
            for (const leafPath of collectLeafPaths(expected)) {
                if (!hasPath(result.value, leafPath)) {
                    problems.push(`${ label }: missing ${ leafPath.join('.') }`);
                }
            }
        }
    }

    for (const { context } of CONFIGS) {
        const label = testAppLabel(context);
        const result = await readOptionalJson(TEST_APP_DIRECTORY, context);

        if (result.problem === 'missing') {
            problems.push(`${ label }: missing; copy lib/${ context } as a starting point`);
        } else if (result.problem) {
            problems.push(`${ label }: ${ result.problem }`);
        }
    }

    return problems;
}

function collectLeafPaths(value, prefix = []) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return [ prefix ];
    }

    return Object.keys(value).flatMap((key) => collectLeafPaths(value[key], prefix.concat(key)));
}

function hasPath(value, keys) {
    let current = value;

    for (const key of keys) {
        if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) {
            return false;
        }

        current = current[key];
    }

    return true;
}

// Matches lib/test/unit-tests/config-templates.test.js so the tool renders
// exactly what the template tests verify.
function json(_context, _options, value) {
    if (value === undefined) {
        throw new Error('The json helper requires a defined value');
    }

    const str = JSON.stringify(value);

    if (typeof str !== 'string') {
        throw new Error('The json helper requires a JSON serializable value');
    }

    return str;
}

function renderTemplate(filename, source, context) {
    // A per-run copy, so the shared helpers map is never mutated.
    const helpers = new Map(templating.helpers);
    helpers.set('json', json);

    const tokens = templating.tokenize(null, filename, source);
    const tree = templating.buildSyntaxTree(null, tokens);
    const render = templating.createRenderFunction(null, helpers, tree);

    return render(context, new Map());
}

function isKeptName(name) {
    return KEEP_NAMES.has(name) || name.startsWith('.env.');
}

function isCopied(source) {
    const relative = path.relative(LIB_DIRECTORY, source);

    // Exclusions apply only to top-level entries; the root itself ('') passes.
    if (relative === '' || relative.includes(path.sep)) {
        return true;
    }

    return !(
        EXCLUDED_NAMES.has(relative)
        || relative.startsWith('.env.')
        || relative.endsWith('-test-context.json')
        || relative.endsWith('.jsonc.template')
    );
}

// The template engine wraps helper errors, so the outer message alone may
// only say `helper "json"`. Join the cause chain for a useful report.
function errorChainMessage(error) {
    const messages = [];
    let current = error;

    while (current) {
        messages.push(current.message || String(current));
        current = current.cause;
    }

    return messages.join(': ');
}

function reportProblems(problems) {
    process.stderr.write('Cannot build test-app/; nothing was written:\n');

    for (const problem of problems) {
        process.stderr.write(`    ${ problem }\n`);
    }
}

function testAppLabel(filename) {
    return `test-app/${ filename }`;
}

function readText(directory, filename) {
    return fsp.readFile(path.join(directory, filename), 'utf8');
}

async function readOptionalText(directory, filename) {
    try {
        return await readText(directory, filename);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

async function readOptionalJson(directory, filename) {
    const text = await readOptionalText(directory, filename);

    if (text === null) {
        return { problem: 'missing' };
    }

    try {
        return { value: JSON.parse(text) };
    } catch {
        // Omit the parser message: V8 quotes a snippet of the input, which
        // would print values from .kixx/secrets.json.
        return { problem: 'invalid JSON' };
    }
}


main().catch((error) => {
    process.stderr.write(`${ error.stack }\n`);
    process.exitCode = 1;
});
