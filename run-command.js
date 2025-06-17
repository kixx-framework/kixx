import process from 'node:process';
import path from 'node:path';
import { parseArgs } from 'node:util';
import * as Application from './application/application.js';
import { readDirectory } from './lib/file-system.js';

import { isNonEmptyString, assertFunction } from './assertions/mod.js';


const options = {
    // The path to the application configuration file.
    config: {
        type: 'string',
    },
    // The environment to run the server in.
    environment: {
        type: 'string',
        default: 'development',
    },
};

const parserOptions = {
    options,
    strict: false,
    allowPositionals: true,
    allowNegative: true,
};


export async function main() {
    const { values, positionals } = parseArgs(parserOptions);
    const commandName = positionals[0];

    if (!isNonEmptyString(commandName)) {
        throw new Error('Command argument is required');
    }

    let configFilepath;
    if (isNonEmptyString(values.config)) {
        configFilepath = path.resolve(values.config);
    } else {
        configFilepath = path.join(process.cwd(), 'app', 'kixx-config.json');
    }

    const context = await Application.initialize(configFilepath, values.environment);

    const commands = await loadCommands(context.paths.commands_directory);

    if (!commands.has(commandName)) {
        throw new Error(`Command "${ commandName }" does not exist`);
    }

    const command = commands.get(commandName);

    const updatedOptions = Object.assign({}, options, command.options || {});

    const updatedParserOptions = Object.assign({}, parserOptions, {
        options: updatedOptions,
        strict: true,
    });

    const args = parseArgs(updatedParserOptions);

    await command.run(context, args.values, ...args.positionals);
}

async function loadCommands(directory) {
    const filepaths = await readDirectory(directory, { includeFullPaths: true });
    const promises = filepaths.map(loadCommand);
    const commands = await Promise.all(promises);

    const map = new Map();

    for (const command of commands) {
        map.set(command.name, command);
    }

    return map;
}

async function loadCommand(filepath) {
    const mod = await import(filepath);

    assertFunction(mod.run, `A command must export a run function (in ${ filepath })`);

    return {
        name: path.basename(filepath, '.js'),
        options: mod.options || {},
        run: mod.run,
    };
}

main().catch((error) => {
    /* eslint-disable no-console */
    console.error('Error running command:');
    console.error(error);
    /* eslint-enable no-console */
    process.exit(1);
});
