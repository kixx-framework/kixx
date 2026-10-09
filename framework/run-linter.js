import process from 'node:process';
import { runLintCli } from 'kixx-linting';

const exitCode = await runLintCli({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
});

process.exit(exitCode);
