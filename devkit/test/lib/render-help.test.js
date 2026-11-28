import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../lib/vendor/kixx-assert/mod.js';
import {
    NOT_AVAILABLE_NOTICE,
    describeCommand,
    renderCommandHelp,
    renderCommandList,
} from '../../lib/render-help.js';
import createPlaceholderCommand from '../../lib/placeholder-command.js';


class PaintCommand {
    static description = `
        Paint the named wall
        in one color
    `;

    static requiresProject = true;

    static positionals = [
        { name: 'wall', description: 'Which wall' },
    ];

    static options = {
        color: {
            type: 'string',
            short: 'c',
            default: 'white',
            description: 'Color of the paint',
        },
        coat: {
            type: 'string',
            multiple: true,
            description: 'A coat to apply; repeat for more',
        },
        'dry-run': {
            type: 'boolean',
        },
    };

    static requiredConfig = [ 'paint.store' ];

    static requiredSecrets = [ 'paint.token', 'paint.account' ];
}

class BareCommand {
    static description = 'Do nothing';
}


describe('render-help', ({ describe }) => {

    describe('describeCommand()', ({ it }) => {
        it('returns every field of the documented schema, in order', () => {
            assertEqual(
                'name,available,description,usage,positionals,options,requiredConfig,requiredSecrets,requiresProject',
                Object.keys(describeCommand('paint', PaintCommand)).join(','),
            );
        });

        it('describes the command itself', () => {
            const help = describeCommand('walls paint', PaintCommand);

            assertEqual('walls paint', help.name);
            assertEqual(true, help.available);
            assertEqual('Paint the named wall in one color', help.description);
            assertEqual('kixx-dev walls paint [options] <wall> [directory]', help.usage);
            assertEqual(true, help.requiresProject);
        });

        it('lists declared positionals as required, then the optional directory', () => {
            const { positionals } = describeCommand('paint', PaintCommand);

            assertEqual(2, positionals.length);
            assertEqual('name,description,required', Object.keys(positionals[0]).join(','));
            assertEqual('wall', positionals[0].name);
            assertEqual(true, positionals[0].required);
            assertEqual('directory', positionals[1].name);
            assertEqual(false, positionals[1].required);
            assertEqual('name,description,required', Object.keys(positionals[1]).join(','));
        });

        it('describes each option, with null for an absent short flag or default', () => {
            const { options } = describeCommand('paint', PaintCommand);

            assertEqual('color,coat,dry-run', options.map(({ name }) => name).join(','));
            assertEqual('name,short,type,multiple,default,description', Object.keys(options[0]).join(','));

            assertEqual('c', options[0].short);
            assertEqual('string', options[0].type);
            assertEqual(false, options[0].multiple);
            assertEqual('white', options[0].default);
            assertEqual('Color of the paint', options[0].description);

            assertEqual(null, options[1].short);
            assertEqual(true, options[1].multiple);
            assertEqual(null, options[1].default);

            assertEqual('boolean', options[2].type);
            assertEqual('', options[2].description);
        });

        it('keeps a default of false', () => {
            const Command = class {
                static description = 'x';

                static options = { force: { type: 'boolean', default: false } };
            };

            assertEqual(false, describeCommand('x', Command).options[0].default);
        });

        it('copies the required settings', () => {
            const help = describeCommand('paint', PaintCommand);

            assertEqual('paint.store', help.requiredConfig.join(','));
            assertEqual('paint.token,paint.account', help.requiredSecrets.join(','));
            assert(help.requiredConfig !== PaintCommand.requiredConfig, 'a copy');
        });

        it('uses empty lists for a command that declares nothing', () => {
            const help = describeCommand('bare', BareCommand);

            assertEqual('kixx-dev bare [options]', help.usage);
            assertEqual(0, help.positionals.length);
            assertEqual(false, help.requiresProject);
            assertEqual(0, help.options.length);
            assertEqual(0, help.requiredConfig.length);
            assertEqual(0, help.requiredSecrets.length);
        });

        it('reports requiresProject, and the directory, for a command that needs tooling', () => {
            const Command = class {
                static description = 'x';

                static requiresTooling = true;
            };

            const help = describeCommand('x', Command);

            assertEqual(true, help.requiresProject);
            assertEqual('kixx-dev x [options] [directory]', help.usage);
            assertEqual('directory', help.positionals[0].name);
        });

        it('lists no directory for a command that runs outside a project', () => {
            const Command = class {
                static description = 'x';

                static positionals = [ { name: 'name', description: 'Name' } ];
            };

            const help = describeCommand('x', Command);

            assertEqual(false, help.requiresProject);
            assertEqual('kixx-dev x [options] <name>', help.usage);
            assertEqual('name', help.positionals.map(({ name }) => name).join(','));
        });

        it('promises a placeholder no arguments', () => {
            const help = describeCommand('deploy', createPlaceholderCommand('Deploy the app'));

            assertEqual(false, help.available);
            assertEqual('kixx-dev deploy', help.usage);
            assertEqual(0, help.positionals.length);
            assertEqual(0, help.options.length);
        });

        it('serializes to JSON and back unchanged', () => {
            const help = describeCommand('paint', PaintCommand);

            assertEqual(JSON.stringify(help), JSON.stringify(JSON.parse(JSON.stringify(help))));
        });
    });

    describe('renderCommandHelp()', ({ it }) => {
        it('renders usage, description, arguments, options, and required settings', () => {
            const text = renderCommandHelp(describeCommand('walls paint', PaintCommand));

            assertEqual([
                'Usage: kixx-dev walls paint [options] <wall> [directory]',
                '',
                '  Paint the named wall in one color',
                '',
                'Arguments:',
                '  wall       Which wall',
                '  directory  A directory in the project; defaults to the current directory',
                '',
                'Options:',
                '  -h, --help              Show this help',
                '  -v, --version           Print the kixx-dev version',
                '      --json              Write the result to stdout as one JSON object',
                '  -c, --color <string>    Color of the paint',
                '      --coat <string>...  A coat to apply; repeat for more',
                '      --dry-run',
                '',
                'Required .kixx/config.json settings:',
                '  paint.store',
                '',
                'Required .kixx/secrets.json settings:',
                '  paint.token',
                '  paint.account',
                '',
            ].join('\n'), text);
        });

        it('leaves out the sections a command has nothing for', () => {
            const text = renderCommandHelp(describeCommand('bare', BareCommand));

            assert(!text.includes('Required'), 'no required settings');
            assertMatches(/^Options:\n {2}-h, --help {5}Show this help$/m, text);
        });

        it('wraps long text at 80 columns and aligns the continuation', () => {
            const Command = class {
                static description = 'word '.repeat(40);

                static options = {
                    target: { type: 'string', description: 'option '.repeat(20) },
                };
            };

            const lines = renderCommandHelp(describeCommand('long', Command)).split('\n');

            for (const line of lines) {
                assert(line.length <= 80, `line fits in 80 columns: ${ line }`);
            }

            const first = lines.findIndex((line) => line.includes('--target <string>'));
            const column = lines[first].indexOf('option');

            assertEqual(column, lines[first + 1].indexOf('option'));
            assertEqual('', lines[first + 1].slice(0, column).trim());
        });

        it('says a placeholder is not available', () => {
            const text = renderCommandHelp(describeCommand('deploy', createPlaceholderCommand('Deploy the app')));

            assertMatches(/^Usage: kixx-dev deploy\n\n {2}Deploy the app\n\n {2}Not available in this version of kixx-dev\.\n\nOptions:\n/, text);
            assert(!text.includes('Arguments:'), 'no arguments');
            assertEqual('Not available in this version of kixx-dev.', NOT_AVAILABLE_NOTICE);
        });

        it('ends with one newline', () => {
            assertMatches(/[^\n]\n$/, renderCommandHelp(describeCommand('bare', BareCommand)));
        });
    });

    describe('renderCommandList()', ({ it }) => {
        const commands = [
            { name: 'build', description: 'Build the thing', available: true },
            { name: 'tools sharpen', description: 'Sharpen a tool', available: true },
            { name: 'deploy', description: 'Deploy the app', available: false },
        ];

        it('renders the top level', () => {
            assertEqual([
                'Usage: kixx-dev <command> [options] [...args]',
                '',
                'Commands:',
                '  build          Build the thing',
                '  tools sharpen  Sharpen a tool',
                '  deploy         Deploy the app (Not available in this version of kixx-dev.)',
                '',
                'Options:',
                '  -h, --help     Show this help',
                '  -v, --version  Print the kixx-dev version',
                '      --json     Write the result to stdout as one JSON object',
                '',
                'Run "kixx-dev <command> --help" for a command\'s arguments and options.',
                '',
            ].join('\n'), renderCommandList({ commands }));
        });

        it('renders a group with its description', () => {
            const text = renderCommandList({
                group: 'tools',
                description: 'Tools for things',
                commands: [ commands[1] ],
            });

            assertMatches(/^Usage: kixx-dev tools <command> \[options\] \[\.\.\.args\]\n\n {2}Tools for things\n\nCommands:\n {2}tools sharpen {2}Sharpen a tool\n/, text);
        });

        it('wraps a long description under its own column', () => {
            const text = renderCommandList({
                commands: [ { name: 'build', description: 'word '.repeat(40).trim(), available: true } ],
            });

            const lines = text.split('\n');
            const first = lines.findIndex((line) => line.startsWith('  build  '));

            assert(lines.every((line) => line.length <= 80), 'every line fits in 80 columns');
            assertMatches(/^ {9}word/, lines[first + 1]);
        });
    });
});
