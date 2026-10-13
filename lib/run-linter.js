import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runLintCli } from 'kixx-linting';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));

// Resolve CLI targets from the caller's directory so they still work
// when the config root is pinned to lib/.
const targets = process.argv.slice(2).map((target) => {
    return path.resolve(process.cwd(), target);
});

const exitCode = await runLintCli({
    argv: targets,
    cwd: ROOT_DIR,
    stdout: process.stdout,
    stderr: process.stderr,
});

process.exit(exitCode);
