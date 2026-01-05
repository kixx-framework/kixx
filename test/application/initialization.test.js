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

        const loggerConfig = context.config.getNamespace('logger');
        assertEqual('debug', loggerConfig.level);
        assertEqual('console', loggerConfig.mode);

        const jwtSecrets = context.config.getSecrets('JSONWebToken');
        assertEqual('development-key', jwtSecrets.KEY);
    });

    it('initialized the logger', () => {
        assert(context.logger);
        const { logger } = context;
        assertEqual('DEBUG', logger.level);
        assertEqual('console', logger.mode);
    });

    it('set the runtime', () => {
        assertEqual(runtime, context.runtime);
    });

    it('sets the paths', () => {
        assert(context.paths);
        const { paths } = context;

        // The app_directory is set as the current working directory
        assertEqual(cwd, paths.app_directory);

        assertEqual(path.join(cwd, 'routes'), paths.routes_directory);
        assertEqual(path.join(cwd, 'public'), paths.public_directory);
        assertEqual(path.join(cwd, 'pages'), paths.pages_directory);
        assertEqual(path.join(cwd, 'templates'), paths.templates_directory);
        assertEqual(path.join(cwd, 'app'), paths.app_plugin_directory);
        assertEqual(path.join(cwd, 'plugins'), paths.plugins_directory);
        assertEqual(path.join(cwd, 'commands'), paths.commands_directory);
        assertEqual(path.join(cwd, 'data'), paths.data_directory);
    });

    it('registers collections', () => {
        const userCollection = context.getCollection('app.User');
        const jobCollection = context.getCollection('job-queue.Job');

        assertEqual('UserCollection', userCollection.constructor.name);
        assertEqual('JobCollection', jobCollection.constructor.name);

        assertEqual(context, userCollection.context);
        assertEqual(context, jobCollection.context);

        assertEqual('string', userCollection.schema.properties.email.type);
        assertEqual('string', jobCollection.schema.properties.datetime.type);
    });

    it('registers views', () => {
        const userView = context.getView('app.UserView');
        const jobView = context.getView('job-queue.JobView');

        assertEqual(context, userView.context);
        assertEqual(context, jobView.context);

        assertEqual('string', userView.schema.properties.email.type);
        assertEqual('string', jobView.schema.properties.datetime.type);
    });

    it('registers forms', () => {
        const userForm = context.getForm('app.UserForm');
        const jobForm = context.getForm('job-queue.JobForm');

        assertEqual(context, userForm.context);
        assertEqual(context, jobForm.context);

        assertEqual('string', userForm.schema.properties.email.type);
        assertEqual('string', jobForm.schema.properties.datetime.type);
    });

    it('registers and initializes services', () => {
        const database = context.getService('Database');
        const hyperview = context.getService('Hyperview');
        const queue = context.getService('JobQueue');

        assert(database.initialized);
        assert(hyperview.initialized);
        assert(queue.initialized);
    });

    it('registers user roles', () => {
        const anonymous = context.getUserRole('anonymous');
        assertEqual('view:app.Products:query:*', anonymous.permissions[0].urn);

        const jobs = context.getUserRole('job-queue-anonymous');
        assertEqual('view:job-queue.Jobs:query:*', jobs.permissions[0].urn);
        assertEqual('form:job-queue.Jobs:save:*', jobs.permissions[1].urn);
    });
});
