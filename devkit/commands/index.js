import DevCommand from './dev.js';
import GenerateCommand from './generate.js';
import LocalCreateCommand from './local/create.js';
import LocalDestroyCommand from './local/destroy.js';
import LocalListCommand from './local/list.js';
import LocalStartCommand from './local/start.js';
import createPlaceholderCommand from '../lib/placeholder-command.js';


/**
 * The first word of every two-word command name, with the one-line
 * description that help prints for the group.
 * @type {Object<string, string>}
 */
export const groups = Object.freeze({
    'agents': 'Agent harness files',
    'local': 'Throwaway local instances of the app',
    'release': 'Release history and emergency rollback',
    'media': 'Site media',
    'env': 'Environments and their branches',
    'cloudflare': 'Cloudflare resources, secrets, and custom domains',
    'secrets': 'Worker secrets',
    'deploy-key': 'The deploy key',
    'admin': 'Bootstrap and operations with the deploy key',
});

// Command name to command class, in the order help lists them. Static imports,
// rather than reading this directory, keep every command in the module graph
// when the CLI is loaded from a registry URL or compiled into one executable.
//
// A placeholder reserves the name of a command that is not built yet. It has
// no module: the section that builds the command adds one and registers it
// here in the placeholder's place. test/commands/tree.test.js pins every name.
export default Object.freeze({
    'new': createPlaceholderCommand('Scaffold a project'),
    'add': createPlaceholderCommand('Install a plugin'),
    'remove': createPlaceholderCommand('Remove a plugin'),
    'upgrade': createPlaceholderCommand('Upgrade vendored code'),
    'generate': GenerateCommand,
    'agents sync': createPlaceholderCommand('Regenerate harness files'),

    'dev': DevCommand,
    'local create': LocalCreateCommand,
    'local start': LocalStartCommand,
    'local list': LocalListCommand,
    'local destroy': LocalDestroyCommand,
    'local seed': createPlaceholderCommand('Create the root admin of a local instance'),
    'local publish': createPlaceholderCommand('Publish content to a local instance'),

    'check': createPlaceholderCommand('Validate content'),
    'routes': createPlaceholderCommand('List routes'),
    'render': createPlaceholderCommand('Render a page'),

    'publish': createPlaceholderCommand('Content-only publish, or pre-stage a build'),
    'deploy': createPlaceholderCommand('Cloudflare: bundle, pre-stage, deploy'),
    'release list': createPlaceholderCommand('Show the release history'),
    'release assign': createPlaceholderCommand('Assign a release; emergency rollback'),
    'media upload': createPlaceholderCommand('Upload media to the site media bucket'),

    'env create': createPlaceholderCommand('Create an environment and its branch'),
    'env list': createPlaceholderCommand('List environments and their branches'),
    'cloudflare provision': createPlaceholderCommand('Provision resources, secrets, and custom domains'),
    'secrets set': createPlaceholderCommand('Set a Worker secret'),
    'secrets rotate': createPlaceholderCommand('Rotate a Worker secret'),
    'deploy-key generate': createPlaceholderCommand('Generate the deploy key'),
    'deploy-key rotate': createPlaceholderCommand('Rotate the deploy key'),

    'admin invite': createPlaceholderCommand('Invite an admin, with the deploy key'),
    'admin reset': createPlaceholderCommand('Reset an admin, with the deploy key'),
    'admin migrations': createPlaceholderCommand('List and run migrations, with the deploy key'),
    'admin jobs': createPlaceholderCommand('Inspect background jobs, with the deploy key'),
});
