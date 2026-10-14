import AppPublishCommand from './publish.js';
import AppAssignBuildCommand from './assign-build.js';


export const description = 'Publish application content';

export const subcommands = {
    publish: AppPublishCommand,
    'assign-build': AppAssignBuildCommand,
};
