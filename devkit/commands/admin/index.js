import GenSecretTokenCommand from './gen-secure-token.js';


export const description = 'Application administration tools';

export const subcommands = {
    'gen-secure-token': GenSecretTokenCommand,
};
