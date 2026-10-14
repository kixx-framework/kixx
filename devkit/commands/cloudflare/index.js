import CloudflareCreateWorkerCommand from './create-worker.js';
import CloudflareUpdateWorkerCommand from './update-worker.js';
import CloudflareDeployVersionCommand from './deploy-version.js';


export const description = 'Tools for working directly with Cloudflare';

export const subcommands = {
    'create-worker': CloudflareCreateWorkerCommand,
    'update-worker': CloudflareUpdateWorkerCommand,
    'deploy-version': CloudflareDeployVersionCommand,
};
