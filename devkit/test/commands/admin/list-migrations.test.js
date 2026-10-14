import { describe } from 'kixx-test';
import { assertEqual, assertMatches } from '../../../lib/vendor/kixx-assert/mod.js';

import AdminListMigrationsCommand from '../../../commands/admin/list-migrations.js';
import captureOutput from '../../helpers/capture-output.js';


describe('admin list-migrations', ({ it }) => {

    it('connects with the prompted credentials and lists each migration', async () => {
        const output = captureOutput();
        const clientOptions = [];
        const command = new AdminListMigrationsCommand({
            output,
            config: { app: { environments: { production: { origin: 'https://admin.example.test' } } } },
            promptForValue: async (options) => `${ options.envVar }-value`,
            createClient: (options) => {
                clientOptions.push(options);
                return {
                    listMigrations: async () => [
                        { id: 'a-migration', status: 'applied', description: 'First' },
                        { id: 'b-migration', status: 'failed', description: 'Second', error: 'boom' },
                    ],
                };
            },
        });

        const code = await command.run({ environment: 'production' });
        const text = output.chunks.join('');

        assertEqual(0, code);
        assertEqual('https://admin.example.test', clientOptions[0].origin);
        assertEqual('KIXX_ADMIN_EMAIL-value', clientOptions[0].email);
        assertEqual('KIXX_ADMIN_PASSWORD-value', clientOptions[0].password);
        assertMatches('a-migration  applied  First', text);
        assertMatches('b-migration  failed  Second\n  error: boom', text);
    });

    it('says so when no migrations are registered', async () => {
        const output = captureOutput();
        const command = new AdminListMigrationsCommand({
            output,
            config: { app: { environments: { production: { origin: 'https://admin.example.test' } } } },
            promptForValue: async () => 'value',
            createClient: () => ({ listMigrations: async () => [] }),
        });

        await command.run({ environment: 'production' });

        assertEqual('No migrations are registered.\n', output.chunks.join(''));
    });
});
