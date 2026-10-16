/**
 * Seeds a local instance over HTTP: boots its app server, creates the root
 * admin with the bootstrap token, mints a Publishing API token, publishes
 * the app's content to the instance's Build ID, and stops the server.
 * @module local/seed-instance
 */

import { isNonEmptyString } from '../vendor/kixx-assert/mod.js';
import defaultAcceptInvite from '../admin/accept-invite.js';
import AdminAPIClient from '../admin/admin-api-client.js';
import {
    AppProcess,
    canConnect as defaultCanConnect,
} from '../devserver/app-process.js';
import { generateSecretToken } from '../crypto.js';
import defaultPublishRelease, { ReleaseAssignmentError } from '../publishing/publish-release.js';
import PublishingAPIClient from '../publishing/publishing-api-client.js';
import { readInstance, writeCredentials } from './instance-store.js';
import UsageError from '../usage-error.js';

const NULL_STREAM = Object.freeze({ write() {} });


/**
 * @param {Object} args
 * @param {string} args.sourceDirectory - Application directory holding node-server.js
 * @param {string} args.instancesDirectory - Absolute instances directory
 * @param {string} args.name - Instance name
 * @param {function(string): void} [args.log] - Writes a status line
 * @param {Object} [args.stdout] - Receives the app server's stdout
 * @param {Object} [args.stderr] - Receives the app server's stderr
 * @param {function(string): string} [args.formatCommand] - Turns "publish alpha"
 *     into a runnable `kixx local` command for recovery hints
 * @returns {Promise<{credentials: Object, credentialsPath: string, publishResult: Object}>}
 * @throws {UsageError} When the instance is missing, already seeded, running,
 *     or incomplete; when the app server fails to start; or when a step fails
 */
export default async function seedInstance(args) {
    const {
        sourceDirectory,
        instancesDirectory,
        name,
        log = () => {},
        stdout = NULL_STREAM,
        stderr = NULL_STREAM,
        formatCommand = (command) => `kixx local ${ command }`,
        createAppProcess = (options) => new AppProcess(options),
        createAdminClient = (options) => new AdminAPIClient(options),
        createPublishingClient = (options) => new PublishingAPIClient(options),
        canConnect = defaultCanConnect,
        acceptInvite = defaultAcceptInvite,
        publishRelease = defaultPublishRelease,
        generatePassword = () => generateSecretToken(),
        fileSystem,
    } = args ?? {};

    const instance = await readInstance({ instancesDirectory, name });
    const { paths, port } = instance;

    if (instance.isSeeded) {
        throw new UsageError(
            `Local instance "${ name }" is already seeded (${ paths.credentials } exists); ` +
            'destroy and re-create it to seed again.',
        );
    }

    const buildId = instance.env.BUILD_ID;
    const inviteToken = instance.secrets.ADMIN_BOOTSTRAP_TOKEN;

    if (!isNonEmptyString(buildId)) {
        throw new UsageError(`BUILD_ID is missing from ${ paths.dotenv }; destroy and re-create the instance "${ name }".`);
    }

    if (!isNonEmptyString(inviteToken)) {
        throw new UsageError(
            `ADMIN_BOOTSTRAP_TOKEN is missing from ${ paths.dotenvSecrets }; ` +
            `destroy and re-create the instance "${ name }".`,
        );
    }

    if (await canConnect(port)) {
        throw new UsageError(
            `Port ${ port } of local instance "${ name }" already accepts connections; ` +
            'stop whatever is running there before seeding.',
        );
    }

    const appProcess = createAppProcess({
        projectDirectory: sourceDirectory,
        environment: 'local',
        dotenv: paths.dotenv,
        getFreePort: async () => port,
        stdout,
        stderr,
        log,
    });

    try {
        const ready = await appProcess.ensureReady();

        if (ready.failure) {
            const { reason, output } = ready.failure;
            let message = `The app server for local instance "${ name }" failed to start: ${ reason }`;

            if (isNonEmptyString(output)) {
                message += `\n\nApp server output:\n${ output }`;
            }

            throw new UsageError(message);
        }

        return await seedRunningServer({
            name,
            port,
            buildId,
            inviteToken,
            paths,
            sourceDirectory,
            formatCommand,
            createAdminClient,
            createPublishingClient,
            acceptInvite,
            publishRelease,
            generatePassword,
            fileSystem,
            log,
        });
    } finally {
        await appProcess.stop();
    }
}


async function seedRunningServer(args) {
    const {
        name,
        port,
        buildId,
        inviteToken,
        paths,
        sourceDirectory,
        formatCommand,
        createAdminClient,
        createPublishingClient,
        acceptInvite,
        publishRelease,
        generatePassword,
        fileSystem,
        log,
    } = args;

    const origin = `http://localhost:${ port }`;
    const username = `root@${ name }.local`;
    const password = generatePassword();

    log(`creating admin ${ username }`);

    await acceptInvite({
        client: createAdminClient({ origin }),
        inviteToken,
        emailAddress: username,
        password,
    });

    log('minting a Publishing API token');

    const token = await createAdminClient({ origin, email: username, password })
        .createPublishingApiToken({ description: 'kixx local seed' });

    const credentials = {
        baseUrl: `${ origin }/`,
        username,
        password,
        publishingApiToken: token.token,
        buildId,
        port,
    };

    // Saved before publishing: the bootstrap token is spent, so a failed
    // publish must not lose the only admin login.
    await writeCredentials(paths, credentials);

    log(`publishing content to build ${ buildId }`);

    const recovery = `Recover with: ${ formatCommand(`start ${ name }`) }, then ${ formatCommand(`publish ${ name }`) }`;

    let publishResult;

    try {
        publishResult = await publishRelease({
            client: createPublishingClient({ origin, token: credentials.publishingApiToken }),
            projectDirectory: sourceDirectory,
            buildId,
            fileSystem,
            formatRecovery: () => recovery,
        });
    } catch (cause) {
        let message = `Local instance "${ name }" has an admin and credentials saved in ` +
            `${ paths.credentials }, but publishing content failed: ${ cause.message }`;

        // An assignment failure already ends with the recovery line.
        if (!(cause instanceof ReleaseAssignmentError)) {
            message += `\n${ recovery }`;
        }

        throw new UsageError(message, { cause });
    }

    return { credentials, credentialsPath: paths.credentials, publishResult };
}
