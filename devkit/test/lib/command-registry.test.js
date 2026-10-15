import { describe } from 'kixx-test';
import { assertEqual } from '../../lib/vendor/kixx-assert/mod.js';
import CommandRegistry from '../../lib/command-registry.js';


class ZuluCommand {
    static description = 'Zulu sub-command';
}

class AlphaCommand {
    static description = 'Alpha sub-command';
}


function makeRegistry() {
    return new CommandRegistry({
        tools: {
            description: 'Tools',
            subcommands: {
                zulu: ZuluCommand,
                alpha: AlphaCommand,
            },
        },
        apps: {
            description: 'Apps',
            subcommands: {},
        },
    });
}


describe('CommandRegistry', ({ it }) => {

    it('lists commands alphabetically with descriptions', () => {
        const commands = makeRegistry().listCommands();

        assertEqual('apps,tools', commands.map(({ name }) => name).join(','));
        assertEqual('Apps', commands[0].description);
    });

    it('lists sub-commands in declaration order with descriptions', () => {
        const subCommands = makeRegistry().listSubCommands('tools');

        assertEqual('zulu,alpha', subCommands.map(({ name }) => name).join(','));
        assertEqual('Zulu sub-command', subCommands[0].description);
    });

    it('resolves a registered sub-command to its class', () => {
        assertEqual(AlphaCommand, makeRegistry().resolveCommand('tools', 'alpha'));
    });

    it('returns null for an unknown sub-command', () => {
        assertEqual(null, makeRegistry().resolveCommand('tools', 'missing'));
    });

    it('does not resolve inherited object properties as commands', () => {
        const registry = makeRegistry();

        assertEqual(false, registry.commandExists('constructor'));
        assertEqual(false, registry.commandExists('__proto__'));
        assertEqual(true, registry.commandExists('tools'));
        assertEqual(null, registry.resolveCommand('tools', 'constructor'));
        assertEqual(null, registry.resolveCommand('tools', 'toString'));
    });
});
