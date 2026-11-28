import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from '../../lib/vendor/kixx-assert/mod.js';
import CommandRegistry, { findCommandProblems, findRegistryProblems } from '../../lib/command-registry.js';


class BuildCommand {
    static description = 'Build the thing';
}

class SharpenCommand {
    static description = `
        Sharpen
        a tool
    `;
}

class PolishCommand {
    static description = 'Polish a tool';

    static available = false;
}

const GROUPS = { tools: ' Tools for things ' };


function makeRegistry() {
    return new CommandRegistry({
        'build': BuildCommand,
        'tools sharpen': SharpenCommand,
        'tools polish': PolishCommand,
    }, GROUPS);
}

function makeCommand(statics) {
    return Object.assign(class Command {}, { description: 'A command' }, statics);
}


describe('CommandRegistry', ({ describe }) => {

    describe('resolve()', ({ it }) => {
        it('resolves a one-word command', () => {
            const resolved = makeRegistry().resolve([ 'build' ]);

            assertEqual('build', resolved.name);
            assertEqual(BuildCommand, resolved.Command);
            assertEqual(1, resolved.wordCount);
        });

        it('resolves a two-word command', () => {
            const resolved = makeRegistry().resolve([ 'tools', 'sharpen' ]);

            assertEqual('tools sharpen', resolved.name);
            assertEqual(SharpenCommand, resolved.Command);
            assertEqual(2, resolved.wordCount);
        });

        it('leaves the words after the name alone', () => {
            assertEqual(1, makeRegistry().resolve([ 'build', 'alpha', 'beta' ]).wordCount);
            assertEqual(2, makeRegistry().resolve([ 'tools', 'sharpen', 'alpha' ]).wordCount);
        });

        it('lets the first two words win over the first word', () => {
            const registry = new CommandRegistry({ 'tools': BuildCommand, 'tools sharpen': SharpenCommand });

            assertEqual(SharpenCommand, registry.resolve([ 'tools', 'sharpen' ]).Command);
            assertEqual(BuildCommand, registry.resolve([ 'tools', 'other' ]).Command);
        });

        it('returns null for a group alone, an unknown name, and no words', () => {
            assertEqual(null, makeRegistry().resolve([ 'tools' ]));
            assertEqual(null, makeRegistry().resolve([ 'tools', 'nope' ]));
            assertEqual(null, makeRegistry().resolve([ 'nope' ]));
            assertEqual(null, makeRegistry().resolve([]));
        });

        it('does not resolve inherited object properties', () => {
            assertEqual(null, makeRegistry().resolve([ 'constructor' ]));
            assertEqual(null, makeRegistry().resolve([ '__proto__' ]));
            assertEqual(null, makeRegistry().resolve([ 'tools', 'toString' ]));
        });
    });

    describe('groups', ({ it }) => {
        it('knows its groups', () => {
            assertEqual(true, makeRegistry().hasGroup('tools'));
            assertEqual(false, makeRegistry().hasGroup('build'));
            assertEqual(false, makeRegistry().hasGroup('constructor'));
        });

        it('describes a group on one line', () => {
            assertEqual('Tools for things', makeRegistry().describeGroup('tools'));
            assertEqual('', makeRegistry().describeGroup('nope'));
        });

        it('works without groups', () => {
            assertEqual(false, new CommandRegistry({ build: BuildCommand }).hasGroup('build'));
        });
    });

    describe('listCommands()', ({ it }) => {
        it('lists every command in declaration order', () => {
            const commands = makeRegistry().listCommands();

            assertEqual('build,tools sharpen,tools polish', commands.map(({ name }) => name).join(','));
        });

        it('puts each description on one line and marks placeholders', () => {
            const commands = makeRegistry().listCommands();

            assertEqual('Sharpen a tool', commands[1].description);
            assertEqual(true, commands[1].available);
            assertEqual(false, commands[2].available);
            assertEqual('name,description,available', Object.keys(commands[0]).join(','));
        });

        it('lists one group', () => {
            const commands = makeRegistry().listCommands('tools');

            assertEqual('tools sharpen,tools polish', commands.map(({ name }) => name).join(','));
        });

        it('does not match a group by prefix', () => {
            const registry = new CommandRegistry({ 'tools sharpen': SharpenCommand, 'toolshed open': BuildCommand });

            assertEqual('tools sharpen', registry.listCommands('tools').map(({ name }) => name).join(','));
        });
    });
});

describe('findRegistryProblems()', ({ it }) => {
    const commands = { 'build': BuildCommand, 'tools sharpen': SharpenCommand };

    it('accepts one-word and two-word names with their groups', () => {
        assertEqual(0, findRegistryProblems(commands, { tools: 'Tools' }).length);
        assertEqual(0, findRegistryProblems({ build: BuildCommand }, {}).length);
    });

    it('rejects a name that is both a command and a group', () => {
        const problems = findRegistryProblems({ ...commands, tools: BuildCommand }, { tools: 'Tools' });

        assertEqual(1, problems.length);
        assertEqual('"tools" is both a command and a group', problems[0]);
    });

    it('rejects a command named like a group even when groups omits it', () => {
        const problems = findRegistryProblems({ ...commands, tools: BuildCommand }, {});

        assert(problems.includes('"tools" is both a command and a group'), problems.join('; '));
    });

    it('rejects a one-word command listed as a group', () => {
        const problems = findRegistryProblems({ build: BuildCommand }, { build: 'Build' });

        assertEqual('"build" is both a command and a group', problems.join('; '));
    });

    it('rejects a two-word name whose group has no description', () => {
        const problems = findRegistryProblems(commands, {});

        assertEqual(1, problems.length);
        assertMatches('group "tools" of "tools sharpen" has no description', problems[0]);
    });

    it('rejects a group with no command', () => {
        const problems = findRegistryProblems(commands, { tools: 'Tools', extra: 'Extra' });

        assertEqual('group "extra" has no command', problems.join('; '));
    });

    it('rejects a group with an empty description', () => {
        const problems = findRegistryProblems(commands, { tools: '  ' });

        assertEqual('group "tools" needs a description', problems.join('; '));
    });

    it('rejects malformed names', () => {
        for (const name of [ '', 'Build', 'a b c', 'tools  sharpen', ' build', 'build ', '1st', 'tools/sharpen' ]) {
            const problems = findRegistryProblems({ [name]: BuildCommand }, { tools: 'Tools', a: 'A' });

            assert(
                problems.some((problem) => problem.includes('must be one or two lowercase words')),
                `expected a problem for "${ name }"`,
            );
        }
    });
});

describe('findCommandProblems()', ({ it }) => {
    it('accepts a class with only a description', () => {
        assertEqual(0, findCommandProblems(BuildCommand).length);
    });

    it('accepts the full static contract', () => {
        const Command = makeCommand({
            available: false,
            options: {
                target: { type: 'string', short: 't', description: 'Target' },
                force: { type: 'boolean' },
            },
            positionals: [ { name: 'name', description: 'Name' } ],
            requiresProject: true,
            requiresTooling: true,
            requiredConfig: [ 'a.b' ],
            requiredSecrets: [],
        });

        assertEqual(0, findCommandProblems(Command).length);
    });

    it('rejects a value that is not a class', () => {
        assertEqual(1, findCommandProblems({ description: 'x' }).length);
        assertEqual(1, findCommandProblems(undefined).length);
    });

    it('rejects a missing or blank description', () => {
        for (const description of [ undefined, '', '   ', 42 ]) {
            const problems = findCommandProblems(makeCommand({ description }));

            assertEqual('description must be a non-empty string', problems.join('; '));
        }
    });

    it('rejects the flags the runner owns', () => {
        for (const flagName of [ 'help', 'version', 'json' ]) {
            const problems = findCommandProblems(makeCommand({ options: { [flagName]: { type: 'boolean' } } }));

            assertEqual(`--${ flagName } is reserved for the runner`, problems.join('; '));
        }
    });

    it('rejects the short flags the runner owns', () => {
        for (const short of [ 'h', 'v' ]) {
            const problems = findCommandProblems(makeCommand({ options: { verbose: { type: 'boolean', short } } }));

            assertEqual(`-${ short } is reserved for the runner`, problems.join('; '));
        }
    });

    it('rejects malformed options', () => {
        assertEqual(1, findCommandProblems(makeCommand({ options: [] })).length);
        assertEqual(1, findCommandProblems(makeCommand({ options: { port: { type: 'number' } } })).length);
        assertEqual(1, findCommandProblems(makeCommand({ options: { port: 'string' } })).length);
    });

    it('rejects malformed positionals', () => {
        const malformed = [
            'name',
            [ 'name' ],
            [ { name: 'Name', description: 'x' } ],
            [ { name: 'directory', description: 'x' } ],
            [ { name: 'name' } ],
        ];

        for (const positionals of malformed) {
            assertEqual(1, findCommandProblems(makeCommand({ positionals })).length, JSON.stringify(positionals));
        }
    });

    it('rejects malformed required settings and available', () => {
        assertEqual(1, findCommandProblems(makeCommand({ requiredConfig: 'a.b' })).length);
        assertEqual(1, findCommandProblems(makeCommand({ requiresProject: true, requiredSecrets: [ '' ] })).length);
        assertEqual(1, findCommandProblems(makeCommand({ available: 'no' })).length);
    });

    it('rejects a requiresProject or requiresTooling that is not a boolean', () => {
        assertEqual(
            'requiresProject must be a boolean',
            findCommandProblems(makeCommand({ requiresProject: 'yes' })).join('; '),
        );
        assertEqual(
            'requiresTooling must be a boolean',
            findCommandProblems(makeCommand({ requiresTooling: 1 })).join('; '),
        );
    });

    it('rejects required settings on a command that runs outside a project', () => {
        for (const key of [ 'requiredConfig', 'requiredSecrets' ]) {
            const problems = findCommandProblems(makeCommand({ [key]: [ 'a.b' ] }));

            assertEqual(1, problems.length);
            assertMatches(`${ key } needs requiresProject`, problems[0]);

            assertEqual(0, findCommandProblems(makeCommand({ [key]: [ 'a.b' ], requiresProject: true })).length);
            assertEqual(0, findCommandProblems(makeCommand({ [key]: [ 'a.b' ], requiresTooling: true })).length);
            assertEqual(0, findCommandProblems(makeCommand({ [key]: [] })).length);
        }
    });
});
