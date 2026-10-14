import { describe } from 'kixx-test';
import { assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';

import promptAdminCredentials from '../../../lib/admin/prompt-admin-credentials.js';


describe('admin/prompt-admin-credentials', ({ it }) => {

    it('reads the email visibly and the password masked from the admin variables', async () => {
        const calls = [];

        const credentials = await promptAdminCredentials({
            promptForValue: async (options) => {
                calls.push(options);
                return `${ options.envVar }-value`;
            },
        });

        assertEqual('KIXX_ADMIN_EMAIL-value', credentials.email);
        assertEqual('KIXX_ADMIN_PASSWORD-value', credentials.password);
        assertEqual('KIXX_ADMIN_EMAIL', calls[0].envVar);
        assertEqual(false, Boolean(calls[0].mask));
        assertEqual('KIXX_ADMIN_PASSWORD', calls[1].envVar);
        assertEqual(true, calls[1].mask);
    });
});
