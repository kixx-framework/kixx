import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';

import * as templating from '../../kixx/templating/mod.js';
import { parseJsonc } from '../../kixx/config/parse-jsonc.js';


const LIB_DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');


describe('config templates', ({ describe }) => {

    describe('node-config.jsonc.template', ({ it }) => {
        const TEMPLATE = 'node-config.jsonc.template';
        const exampleContext = readJson('node-config-test-context.json');

        it('reproduces node-config.jsonc from the example context', () => {
            const expected = parseJsonc(readText('node-config.jsonc'));
            const actual = parseJsonc(renderTemplate(TEMPLATE, exampleContext));

            assertSameConfig(expected, actual);
        });

        it('renders no HTML entities', () => {
            const output = renderTemplate(TEMPLATE, exampleContext);

            assert(!/&(amp|quot|lt|gt);/.test(output), 'expected no HTML entities in the output');
        });

        it('round-trips values containing HTML special characters', () => {
            const value = 'a & b < c > d " e';
            const context = structuredClone(exampleContext);
            context.environments.production.FILES.bucket = value;
            context.environments.local.OBJECT_STORE.path = value;

            const actual = parseJsonc(renderTemplate(TEMPLATE, context));

            assertEqual(value, actual.environments.production.FILES.bucket);
            assertEqual(value, actual.environments.local.OBJECT_STORE.path);
        });

        it('fails when a required value is missing', () => {
            const context = structuredClone(exampleContext);
            delete context.environments.production.LOGGER.level;

            const caught = catchError(() => renderTemplate(TEMPLATE, context));

            assert(caught, 'expected an error to be thrown');
            assertMatches('helper "json"', errorChainMessages(caught));
        });

        it('renders only developerMode when no content directories are given', () => {
            const context = structuredClone(exampleContext);
            context.environments.development.CONTENT_STORE = { developerMode: true };

            const actual = parseJsonc(renderTemplate(TEMPLATE, context));

            assertEqual(
                JSON.stringify({ developerMode: true }),
                JSON.stringify(actual.environments.development.CONTENT_STORE),
            );
        });
    });

    describe('cloudflare-config.jsonc.template', ({ it }) => {
        const TEMPLATE = 'cloudflare-config.jsonc.template';
        const exampleContext = readJson('cloudflare-config-test-context.json');

        it('reproduces cloudflare-config.jsonc from the example context', () => {
            const expected = parseJsonc(readText('cloudflare-config.jsonc'));
            const actual = parseJsonc(renderTemplate(TEMPLATE, exampleContext));

            assertSameConfig(expected, actual);
        });

        it('renders no HTML entities', () => {
            const output = renderTemplate(TEMPLATE, exampleContext);

            assert(!/&(amp|quot|lt|gt);/.test(output), 'expected no HTML entities in the output');
        });

        it('omits resource IDs which are not given', () => {
            const expected = parseJsonc(readText('cloudflare-config.jsonc'));
            delete expected.environments.production.DOCUMENT_STORE.databaseId;
            delete expected.environments.production.KEY_VALUE_STORE.namespaceId;
            delete expected.environments.production.CONTENT_STORE.kvNamespaceId;

            const context = structuredClone(exampleContext);
            delete context.environments.production.DOCUMENT_STORE.databaseId;
            delete context.environments.production.KEY_VALUE_STORE.namespaceId;
            delete context.environments.production.CONTENT_STORE.kvNamespaceId;

            const actual = parseJsonc(renderTemplate(TEMPLATE, context));

            assertSameConfig(expected, actual);
        });

        it('renders optional values which are given', () => {
            const tags = [ 'app:kixx', 'env:production' ];
            const tailConsumers = [{ service: 'log-tail' }];
            const limits = { cpu_ms: 300000, subrequests: 100 };
            const placement = { mode: 'smart' };
            const migrations = [{ tag: 'v1', new_sqlite_classes: [ 'JobQueueStore' ] }];

            const context = structuredClone(exampleContext);
            const env = context.environments.production;
            env.WORKER.tags = tags;
            env.WORKER.tail_consumers = tailConsumers;
            env.WORKER_VERSION.limits = limits;
            env.WORKER_VERSION.placement = placement;
            env.DURABLE_OBJECT_MIGRATIONS = migrations;

            const actual = parseJsonc(renderTemplate(TEMPLATE, context)).environments.production;

            assertEqual(JSON.stringify(tags), JSON.stringify(actual.WORKER.tags));
            assertEqual(JSON.stringify(tailConsumers), JSON.stringify(actual.WORKER.tail_consumers));
            assertEqual(JSON.stringify(limits), JSON.stringify(actual.WORKER_VERSION.limits));
            assertEqual(JSON.stringify(placement), JSON.stringify(actual.WORKER_VERSION.placement));
            assertEqual(JSON.stringify(migrations), JSON.stringify(actual.DURABLE_OBJECT_MIGRATIONS));
        });

        it('renders compatibility_flags as an array', () => {
            const context = structuredClone(exampleContext);
            context.environments.production.WORKER_VERSION.compatibility_flags = [ 'nodejs_compat' ];

            const actual = parseJsonc(renderTemplate(TEMPLATE, context));

            assertEqual(
                JSON.stringify([ 'nodejs_compat' ]),
                JSON.stringify(actual.environments.production.WORKER_VERSION.compatibility_flags),
            );
        });

        it('round-trips values containing HTML special characters', () => {
            const value = 'App & Co <app@example.com> "quoted"';
            const context = structuredClone(exampleContext);
            context.environments.production.SEND_EMAIL.from = value;

            const actual = parseJsonc(renderTemplate(TEMPLATE, context));

            assertEqual(value, actual.environments.production.SEND_EMAIL.from);
        });

        it('fails when a required value is missing', () => {
            const context = structuredClone(exampleContext);
            delete context.environments.production.WORKER.name;

            const caught = catchError(() => renderTemplate(TEMPLATE, context));

            assert(caught, 'expected an error to be thrown');
            assertMatches('helper "json"', errorChainMessages(caught));
        });
    });
});


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

function renderTemplate(filename, context) {
    const helpers = new Map(templating.helpers);
    helpers.set('json', json);

    const tokens = templating.tokenize(null, filename, readText(filename));
    const tree = templating.buildSyntaxTree(null, tokens);
    const render = templating.createRenderFunction(null, helpers, tree);

    return render(context, new Map());
}

function readText(filename) {
    return fs.readFileSync(path.join(LIB_DIRECTORY, filename), 'utf8');
}

function readJson(filename) {
    return JSON.parse(readText(filename));
}

function assertSameConfig(expected, actual) {
    assertEqual(expected.name, actual.name);

    assertEqual(
        JSON.stringify(Object.keys(expected.environments)),
        JSON.stringify(Object.keys(actual.environments)),
    );

    for (const envName of Object.keys(expected.environments)) {
        assertEqual(
            JSON.stringify(expected.environments[envName]),
            JSON.stringify(actual.environments[envName]),
            envName,
        );
    }
}

function errorChainMessages(error) {
    const messages = [];
    let current = error;

    while (current) {
        messages.push(current.message);
        current = current.cause;
    }

    return messages.join('\n');
}

function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}
