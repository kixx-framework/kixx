import process from 'node:process';

import { OperationalError } from '../src/kixx/errors/mod.js';
import { isNonEmptyString } from '../src/kixx/assertions/mod.js';
import {
    createInstance,
    destroyInstance,
    getCredentialsPath,
    findProcessEnvCollisions,
} from './local-target/instance.js';
import { seedInstance } from './local-target/seed.js';
import { serveInstance } from './local-target/serve.js';


const USAGE = 'Usage: node tools/local-target.js <create|seed|serve|destroy> <name>';

// credentials.json is written in plain text inside data/local-targets/<name>/,
// which is git-ignored but not otherwise protected. Treat it like any other
// local secret: do not commit it or paste it somewhere shared.
const CREDENTIALS_NOTICE = 'credentials.json is plain text; do not commit it or share it outside this workstation.';

async function main() {
    const [ verb, name ] = process.argv.slice(2);

    if (!isNonEmptyString(verb)) {
        throw new OperationalError(USAGE);
    }

    switch (verb) {
        case 'create':
            await runCreate(name);
            break;
        case 'seed':
            await runSeed(name);
            break;
        case 'serve':
            await runServe(name);
            break;
        case 'destroy':
            await runDestroy(name);
            break;
        default:
            throw new OperationalError(`Unknown verb "${ verb }". ${ USAGE }`);
    }
}

async function runCreate(name) {
    const { port, buildId, dataDirectory } = await createInstance(name);

    const collisions = findProcessEnvCollisions();
    if (collisions.length > 0) {
        write(`Warning: the following variables are set in this shell and will collide with the generated dotenv pair at startup: ${ collisions.join(', ') }\n`);
    }

    write(`Created local target instance "${ name }"\n`);
    write(`  port: ${ port }\n`);
    write(`  build id: ${ buildId }\n`);
    write(`  data directory: ${ dataDirectory }\n`);
    write('Next: node tools/local-target.js seed ' + name + '\n');
}

async function runSeed(name) {
    const credentials = await seedInstance(name);

    write(`Seeded local target instance "${ name }"\n`);
    write(`  base url: ${ credentials.baseUrl }\n`);
    write(`  username: ${ credentials.username }\n`);
    write(`  credentials file: ${ getCredentialsPath(name) }\n`);
    write(`${ CREDENTIALS_NOTICE }\n`);
    write('Next: node tools/local-target.js serve ' + name + '\n');
}

async function runServe(name) {
    const exitCode = await serveInstance(name);
    process.exitCode = exitCode;
}

async function runDestroy(name) {
    await destroyInstance(name);
    write(`Destroyed local target instance "${ name }"\n`);
}

function write(message) {
    process.stdout.write(message);
}

main().catch((error) => {
    if (error.expected) {
        process.stderr.write(`${ error.message }\n`);
        process.exitCode = 1;
        return;
    }

    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
