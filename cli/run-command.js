import process from 'node:process';
import { EOL } from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Application from '../lib/application/application.js';
import { readDirectory, importAbsoluteFilepath } from '../lib/lib/file-system.js';
import { isNonEmptyString, assertFunction } from '../lib/assertions/mod.js';

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.join(CLI_DIR, 'docs');


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
    environment: {
        short: 'e',
        type: 'string',
        default: 'development',
    },
};


/* eslint-disable no-console */


export async function main(args) {
    const { values, positionals } = parseArgs({
        args,
        options,
        strict: false,
        allowPositionals: true,
        allowNegative: true,
    });

    if (values.help) {
        console.error(readDocFile('run-command.md'));
        process.exit(1);
        return;
    }

    const commandName = positionals[0];

    const currentWorkingDirectory = process.cwd();

    const applicationDirectory = isNonEmptyString(values.dir) ? values.dir : null;
    const configFilepath = isNonEmptyString(values.config) ? path.resolve(values.config) : null;
    const secretsFilepath = isNonEmptyString(values.secrets) ? path.resolve(values.secrets) : null;

    const environment = values.environment;

    const app = new Application({
        currentWorkingDirectory,
        applicationDirectory,
    });

    const runtime = { command: commandName };

    const context = await app.initialize({
        runtime,
        environment,
        configFilepath,
        secretsFilepath,
    });

    // eslint-disable-next-line require-atomic-updates
    process.title = `node-${ context.config.processName }`;
    // NOTE: We've seen process names get truncated.
    // For example, on Ubuntu Linux this is truncated to 15 characters.

    const commands = await loadCommands(context.paths.commands_directory);

    if (!isNonEmptyString(commandName)) {
        console.error('We need a command name to run.');
        console.error('(The first positional argument to kixx run-command.)' + EOL);
        console.error('Available custom commands are:' + EOL);
        for (const cmd of commands.keys()) {
            console.error(`- ${ cmd }`);
        }
        console.error(EOL + 'Help:' + EOL);
        console.error(readDocFile('run-command.md'));
        process.exit(1);
        return;
    }

    if (!commands.has(commandName)) {
        console.error(`The command "${ commandName }" is not implemented.` + EOL);
        console.error('Available custom commands are:' + EOL);
        for (const cmd of commands.keys()) {
            console.error(`- ${ cmd }`);
        }
        console.error(EOL + 'Help:' + EOL);
        console.error(readDocFile('run-command.md'));
        process.exit(1);
        return;
    }

    const command = commands.get(commandName);

    const updatedOptions = Object.assign({}, options, command.options || {});

    const subArgs = parseArgs({
        // Slice off the cammand name positional arg.
        args: args.slice(1),
        options: updatedOptions,
        strict: true,
        allowPositionals: true,
        allowNegative: true,
    });

    await command.run(context, subArgs.values, ...subArgs.positionals);
}

async function loadCommands(directory) {
    const files = await readDirectory(directory);

    const promises = files.map((file) => {
        return loadCommand(path.join(directory, file.name));
    });

    const commands = await Promise.all(promises);

    const map = new Map();

    for (const command of commands) {
        map.set(command.name, command);
    }

    return map;
}

async function loadCommand(filepath) {
    const mod = await importAbsoluteFilepath(filepath);

    assertFunction(mod.run, `A command must export a run function (in ${ filepath })`);

    return {
        name: path.basename(filepath, '.js'),
        options: mod.options || {},
        run: mod.run,
    };
}

function readDocFile(filename) {
    const filepath = path.join(DOCS_DIR, filename);
    return fs.readFileSync(filepath, { encoding: 'utf8' });
}
