#!/usr/bin/env node

import process from 'node:process';
import * as InitProject from '../cli/kixx-dev/init-project.js';


const args = process.argv.slice(2);
const commandName = args.shift();


if (!commandName) {
    // eslint-disable-next-line no-console
    console.error('A command name is required');
    process.exit(1);
}


let promise;

switch (commandName) {
    case 'init-project':
        promise = InitProject.main(args);
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
