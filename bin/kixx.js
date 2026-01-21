#!/usr/bin/env node

import { EOL } from 'node:os';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as InitProject from '../cli/init-project.js';
import * as AppServer from '../cli/app-server.js';
import * as RunCommand from '../cli/run-command.js';
import * as DevServer from '../cli/dev-server.js';


const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DOCS_DIR = path.join(ROOT_DIR, 'cli', 'docs');

const args = process.argv.slice(2);
const commandName = args.shift();

/* eslint-disable no-console */


if (!commandName) {
    console.error('Kixx requires a command name. Available commands are:' + EOL);
    console.error(readDocFile('valid-commands.md'));
    process.exit(1);
}


let promise;

switch (commandName) {
    case 'help':
        console.error('Run a Kixx command!' + EOL);
        console.error('Available commands are:' + EOL);
        console.error(readDocFile('valid-commands.md'));
        promise = Promise.resolve();
        break;
    case 'app-server':
        promise = AppServer.main(args);
        break;
    case 'run-command':
        promise = RunCommand.main(args);
        break;
    case 'init-project':
        promise = InitProject.main(args);
        break;
    case 'dev-server':
        promise = DevServer.main(args);
        break;
    default:
        console.error(`The Kixx command "${ commandName }" is not recognized. Available commands are:` + EOL);
        console.log(readDocFile('valid-commands.md'));
        process.exit(1);
}

promise.catch((err) => {
    console.error(`There was an unexpected error while running "${ commandName }":` + EOL);
    console.error(err);
    process.exit(1);
});

function readDocFile(filename) {
    const filepath = path.join(DOCS_DIR, filename);
    return fs.readFileSync(filepath, { encoding: 'utf8' });
}
