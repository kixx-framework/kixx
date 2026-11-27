import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runLintCli } from 'kixx-linting';

const ROOT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

// Targets resolve from the caller's directory. With none, the whole project
// is linted.
const targets = process.argv.slice(2).map((target) => {
    return path.resolve(process.cwd(), target);
});

const exitCode = await runLintCli({
    argv: targets,
    cwd: ROOT_DIRECTORY,
    stdout: process.stdout,
    stderr: process.stderr,
});

process.exit(exitCode);
