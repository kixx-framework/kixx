#!/usr/bin/env node

import process from 'node:process';
import * as DevServer from '../cli/app/dev-server.js';
import * as ProdServer from '../cli/app/server.js';
import * as RunCommand from '../cli/app/run-command.js';


const args = process.argv.slice(2);
const commandName = args.shift();


if (!commandName) {
    // eslint-disable-next-line no-console
    console.error('A command name is required');
    process.exit(1);
}


let promise;

switch (commandName) {
    case 'dev':
        promise = DevServer.main(args);
        break;
    case 'server':
        promise = ProdServer.main(args);
        break;
    case 'run':
        promise = RunCommand.main(args);
        break;
    default:
        // eslint-disable-next-line no-console
        console.error(`The command "${ commandName }" is not recognized`);
        process.exit(1);
}

promise.catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});
