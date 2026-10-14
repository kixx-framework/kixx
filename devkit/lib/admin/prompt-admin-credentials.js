import { promptForValue as defaultPromptForValue } from '../prompt.js';

/**
 * Reads the existing admin's email and password for HTTP Basic auth, from
 * `KIXX_ADMIN_EMAIL` / `KIXX_ADMIN_PASSWORD` or the terminal. Credentials
 * are never accepted from argv or files.
 * @param {Object} [args] - Dependencies
 * @param {Function} [args.promptForValue] - Prompt implementation
 * @returns {Promise<{email: string, password: string}>} Admin credentials
 * @throws {UsageError} When a value is unset and stdin is not a terminal
 */
export default async function promptAdminCredentials(args) {
    const { promptForValue = defaultPromptForValue } = args ?? {};

    const email = await promptForValue({
        envVar: 'KIXX_ADMIN_EMAIL',
        label: 'Admin email address',
    });

    const password = await promptForValue({
        envVar: 'KIXX_ADMIN_PASSWORD',
        label: 'Admin password',
        mask: true,
    });

    return { email, password };
}
