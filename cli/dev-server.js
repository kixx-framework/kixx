import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import ProcessManager from '../lib/process-manager/mod.js';
import { isNonEmptyString, isNumberNotNaN } from '../lib/assertions/mod.js';

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.join(CLI_DIR, 'docs');


const options = {
    help: {
        short: 'h',
        type: 'boolean',
    },
    watch: {
        short: 'w',
        type: 'string',
    },
    pattern: {
        short: 'p',
        type: 'string',
        default: '**/*.js',
    },
    debounce: {
        short: 'd',
        type: 'string',
        default: '300',
    },
};


/* eslint-disable no-console */


export async function main(args) {
    const { values, positionals } = parseArgs({
        args,
        options,
        strict: true,
        allowPositionals: true,
        allowNegative: true,
    });

    if (values.help) {
        console.log(readDocFile('dev-server.md'));
        process.exit(0);
        return;
    }

    const script = positionals[0];
    const scriptArgs = positionals.slice(1);

    if (!isNonEmptyString(script)) {
        console.error('Error: A script path is required as the first argument.');
        console.error('');
        console.log(readDocFile('dev-server.md'));
        process.exit(1);
        return;
    }

    const watchDirectory = isNonEmptyString(values.watch)
        ? values.watch
        : path.dirname(script);

    const pattern = values.pattern;

    let debounceMs = parseInt(values.debounce, 10);
    if (!isNumberNotNaN(debounceMs)) {
        debounceMs = 300;
    }

    const manager = new ProcessManager({
        script,
        watchDirectory,
        pattern,
        debounceMs,
        scriptArgs,
    });

    manager.on('error', (event) => {
        console.error(`[ERROR] ${ event.message }`);
        if (event.cause) {
            console.error(`        ${ event.cause.message }`);
        }
    });

    manager.on('warning', (event) => {
        console.warn(`[WARN]  ${ event.message }`);
    });

    manager.on('info', (event) => {
        console.log(`[INFO]  ${ event.message }`);
    });

    manager.on('debug', () => {
        // Debug messages can be uncommented for development
        // console.log(`[DEBUG] ${ event.message }`);
    });

    console.log('');
    console.log('Starting dev-server...');
    console.log(`  Script: ${ manager.script }`);
    console.log(`  Watch:  ${ manager.watchDirectory }`);
    console.log(`  Pattern: ${ manager.pattern }`);
    console.log('');

    await manager.start();
}

function readDocFile(filename) {
    const filepath = path.join(DOCS_DIR, filename);
    return fs.readFileSync(filepath, { encoding: 'utf8' });
}
