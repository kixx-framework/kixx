#!/usr/bin/env node

import os from 'node:os';
import process from 'node:process';
import commands, { groups } from './commands/index.js';
import loadProjectTooling from './lib/project/load-project-tooling.js';
import runCli from './lib/run-cli.js';


// Everything else lives in lib/run-cli.js, which takes its streams as
// arguments. This file is the only one that touches the process's own.
runCli({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    homeDirectory: os.homedir(),
    stdout: process.stdout,
    stderr: process.stderr,
    commands,
    groups,
    loadProjectTooling,
}).then((exitCode) => {
    // Setting the code, rather than exiting, lets pending output flush.
    process.exitCode = exitCode;
});
