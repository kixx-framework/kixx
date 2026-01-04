import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import {
    assert,
    assertEqual
} from 'kixx-assert';
import Application from '../../lib/application/application.js';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(THIS_DIR, 'initialization-fixtures');

describe('nominal case with kixx config in CWD', ({ before, it }) => {
    const fixtureDirectory = path.join(FIXTURE_DIR, 'nominal');
    const cwd = fixtureDirectory;

    const app = new Application({ currentWorkingDirectory: cwd });
    const runtime = { server: { name: 'server' } };
    const environment = 'development';

    let context;

    before(async () => {
        context = await app.initialize({
            runtime,
            environment,
        });
    });

    it('loaded expected configs', () => {
        assert(context.config);
        assertEqual('Test App', context.config.name);
        assertEqual('testapp', context.config.processName);
    });
});
