import fsp from 'node:fs/promises';
import path from 'node:path';

import { OperationalError } from '../../src/kixx/errors/mod.js';
import sourceConfig from '../../src/node-config.js';
import { readConfig } from '../../src/kixx/config/read-config.js';
import { bootApplication } from '../../src/kixx/context/boot-application.js';
import { readEnvironment, createResolveFilepath } from '../../src/node-environment.js';
import LoggerWriter from '../../src/plugins/node-logger-writer/lib/logger-writer.js';
import * as app from '../../src/app/app.js';
import { plugins as generalPlugins } from '../../src/plugins/general.js';
import { plugins as nodePlugins } from '../../src/plugins/node.js';
import { mergePluginMaps } from '../../src/plugins/merge-plugin-maps.js';
import DeveloperSourceScanner from '../../src/plugins/node-content-store/lib/developer-source-scanner.js';
import { buildReleaseManifest } from '../../src/plugins/node-content-store/lib/release-manifest-builder.js';
import { createRelease } from '../../src/app/transaction-scripts/publishing/create-release.js';
import { assignRelease } from '../../src/app/transaction-scripts/publishing/assign-release.js';
import { createAdminUserAccount } from '../../src/app/transaction-scripts/admin-users/create-admin-user-account.js';
import { createPublishingApiToken } from '../../src/app/transaction-scripts/publishing-api-tokens/create-publishing-api-token.js';
import CreatePublishingApiTokenForm from '../../src/app/presentation/forms/publishing-api-tokens/create-publishing-api-token-form.js';
import {
    REPO_ROOT,
    assertValidName,
    instanceExists,
    getInstanceDirectory,
    getDotenvPath,
    getCredentialsPath,
    generateSecret,
    formatCredentials,
    writeCredentials,
} from './instance.js';


const SEEDED_BY = 'local-target-seed';

/**
 * Boots the application in-process against a local target instance, publishes
 * the working tree as a Release assigned to the instance's Build ID, creates
 * the root admin through the bootstrap invite path, mints a Publishing API
 * token, and writes credentials.json.
 *
 * Every write goes through the same transaction scripts a production deploy
 * uses (createRelease, assignRelease, createAdminUserAccount,
 * createPublishingApiToken) against the application context — this never
 * writes to a collection or store directly.
 *
 * @param {string} name - Instance name.
 * @returns {Promise<Object>} The credentials object written to credentials.json.
 * @throws {OperationalError} When the instance does not exist or credentials.json already exists.
 */
export async function seedInstance(name) {
    assertValidName(name);

    const instanceDirectory = getInstanceDirectory(name);
    if (!instanceExists(name)) {
        throw new OperationalError(`Local target instance "${ name }" does not exist at ${ instanceDirectory }; run create first`);
    }

    const credentialsPath = getCredentialsPath(name);
    if (await fileExists(credentialsPath)) {
        throw new OperationalError(`Local target instance "${ name }" already has ${ credentialsPath }; destroy and re-create the instance to seed it again`);
    }

    const dotenvFile = getDotenvPath(name);
    const env = readEnvironment({ dotenvFile });

    const srcDirectory = path.join(REPO_ROOT, 'src');
    const storeResolveFilepath = createResolveFilepath({ baseDirectory: srcDirectory, dataDirectory: env.DATA_DIRECTORY });
    const config = readConfig(sourceConfig, 'local', { resolveFilepath: storeResolveFilepath });

    const plugins = mergePluginMaps(generalPlugins, nodePlugins);

    const { appContext } = bootApplication({
        env,
        config,
        LoggerWriter,
        plugins,
        app,
    });

    try {
        return await runSeedSequence(appContext, { name, env, srcDirectory });
    } finally {
        await appContext.close();
    }
}

async function runSeedSequence(appContext, options) {
    const { name, env, srcDirectory } = options;

    // Developer source content always lives in the repository's own src/ tree,
    // never inside the instance directory, so this resolver deliberately
    // ignores DATA_DIRECTORY unlike the one readConfig() was given above.
    const resolveSourcePath = createResolveFilepath({ baseDirectory: srcDirectory });

    const scanner = new DeveloperSourceScanner({
        pagesDirectory: resolveSourcePath('pages'),
        templatesDirectory: resolveSourcePath('templates'),
        staticAssetsDirectory: resolveSourcePath('static-assets'),
        emailsDirectory: resolveSourcePath('emails'),
    });

    const contentAddressableStore = appContext.getService('ContentAddressableStore');
    const putObject = async (bytes) => await contentAddressableStore.putObject(appContext, bytes);

    const manifest = await buildReleaseManifest({ scanner, putObject });

    const release = await createRelease(appContext, {
        manifest,
        createdBy: SEEDED_BY,
        provenance: {
            client: SEEDED_BY,
            message: 'Seeded from the working tree by tools/local-target.js',
        },
    });

    await assignRelease(appContext, {
        buildId: env.BUILD_ID,
        releaseId: release.releaseId,
        activatedBy: SEEDED_BY,
        reason: 'publish',
    });

    const emailAddress = `root@${ name }.local`;
    const password = generateSecret(24);

    const { user } = await createAdminUserAccount(appContext, {
        email_address: emailAddress,
        password,
        invite_token: env.ADMIN_BOOTSTRAP_TOKEN,
    });

    const tokenForm = new CreatePublishingApiTokenForm({ description: SEEDED_BY });
    tokenForm.validate();
    const tokenResult = await createPublishingApiToken(appContext, tokenForm, user.id);

    const credentials = formatCredentials({
        port: Number.parseInt(env.PORT, 10),
        buildId: env.BUILD_ID,
        username: emailAddress,
        password,
        publishingApiToken: tokenResult.token,
    });

    await writeCredentials(name, credentials);

    return credentials;
}

async function fileExists(filepath) {
    try {
        await fsp.access(filepath);
        return true;
    } catch {
        return false;
    }
}
