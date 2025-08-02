import process from 'node:process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as Application from '../../lib/application/application.js';
import { readDirectory } from '../../lib/lib/file-system.js';
import { isNonEmptyString, assertFunction } from '../../lib/assertions/mod.js';


const options = {
    // The path to the application configuration file.
    config: {
        short: 'c',
        type: 'string',
    },
    // The environment to run the server in.
    environment: {
        short: 'e',
        type: 'string',
        default: 'development',
    },
};


export async function main(args) {
    const { values, positionals } = parseArgs({
        args,
        options,
        strict: false,
        allowPositionals: true,
        allowNegative: true,
    });

    const commandName = positionals[0];

    if (!isNonEmptyString(commandName)) {
        throw new Error('Command argument is required');
    }

    let configFilepath;
    if (isNonEmptyString(values.config)) {
        configFilepath = path.resolve(values.config);
    } else {
        configFilepath = path.join(process.cwd(), 'kixx-config.json');
    }

    const runtime = { command: commandName };
    const context = await Application.initialize(runtime, configFilepath, values.environment);

    const commands = await loadCommands(context.paths.commands_directory);

    if (!commands.has(commandName)) {
        throw new Error(`Command "${ commandName }" does not exist`);
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
    const filepaths = await readDirectory(directory);
    const promises = filepaths.map(loadCommand);
    const commands = await Promise.all(promises);

    const map = new Map();

    for (const command of commands) {
        map.set(command.name, command);
    }

    return map;
}

async function loadCommand(filepath) {
    const mod = await import(pathToFileURL(filepath));

    assertFunction(mod.run, `A command must export a run function (in ${ filepath })`);

    return {
        name: path.basename(filepath, '.js'),
        options: mod.options || {},
        run: mod.run,
    };
}
