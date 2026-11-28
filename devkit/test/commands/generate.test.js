import path from 'node:path';
import { describe } from 'kixx-test';
import { assert, assertEqual } from '../../lib/vendor/kixx-assert/mod.js';
import GenerateCommand from '../../commands/generate.js';
import { acceptsDirectory, requiresProject } from '../../lib/command-positionals.js';
import captureOutput from '../helpers/capture-output.js';


const PROJECT_DIRECTORY = path.resolve('/work/project');

// What the loader resolves, with a generator that records its calls. The
// command never imports core: the project's own is handed to it.
function makeTooling(writeProjectFiles) {
    const calls = { createProjectFileSystem: [], writeProjectFiles: [] };

    const tooling = Object.freeze({
        tooling: {
            async writeProjectFiles(options) {
                calls.writeProjectFiles.push(options);
                return await writeProjectFiles();
            },
        },
        createProjectFileSystem(projectDirectory) {
            calls.createProjectFileSystem.push(projectDirectory);
            return { root: projectDirectory };
        },
        createFileSystemContentSource() {
            throw new Error('generate reads no content');
        },
    });

    return { tooling, calls };
}

async function catchRejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    return null;
}


describe('generate command', ({ it }) => {

    it('declares that it needs the project\'s tooling, and nothing else', () => {
        assertEqual(true, GenerateCommand.requiresTooling);
        assertEqual(true, requiresProject(GenerateCommand));
        assertEqual(true, acceptsDirectory(GenerateCommand));
        assertEqual(undefined, GenerateCommand.options);
        assertEqual(undefined, GenerateCommand.positionals);
    });

    it('calls the project\'s generator with a file system rooted at the project', async () => {
        const { tooling, calls } = makeTooling(() => [ 'routes.generated.js' ]);
        const command = new GenerateCommand({ projectDirectory: PROJECT_DIRECTORY, tooling, output: captureOutput() });

        await command.run({}, {});

        assertEqual(PROJECT_DIRECTORY, calls.createProjectFileSystem.join(','));
        assertEqual(1, calls.writeProjectFiles.length);
        assertEqual('fileSystem', Object.keys(calls.writeProjectFiles[0]).join(','));
        assertEqual(PROJECT_DIRECTORY, calls.writeProjectFiles[0].fileSystem.root);
    });

    it('writes one line per file and returns the project directory and the file names', async () => {
        const fileNames = [ 'node-registry.generated.js', 'example.env.secrets' ];
        const { tooling } = makeTooling(() => fileNames);
        const output = captureOutput();
        const command = new GenerateCommand({ projectDirectory: PROJECT_DIRECTORY, tooling, output });

        const data = await command.run({}, {});

        assertEqual(
            `wrote ${ path.join(PROJECT_DIRECTORY, 'node-registry.generated.js') }\n`
            + `wrote ${ path.join(PROJECT_DIRECTORY, 'example.env.secrets') }\n`,
            output.chunks.join(''),
        );

        assertEqual('projectDirectory,files', Object.keys(data).join(','));
        assertEqual(PROJECT_DIRECTORY, data.projectDirectory);
        assertEqual(fileNames.join(','), data.files.join(','));
        assert(data.files !== fileNames, 'a copy');
        assertEqual(JSON.stringify(data), JSON.stringify(JSON.parse(JSON.stringify(data))));
    });

    it('lets the generator\'s error through and writes nothing', async () => {
        // Shaped like core's class, which the devkit never imports.
        const failure = new Error('Invalid app manifest app/app.json: secrets must be an array');
        failure.name = 'ValidationError';

        const { tooling } = makeTooling(() => {
            throw failure;
        });

        const output = captureOutput();
        const command = new GenerateCommand({ projectDirectory: PROJECT_DIRECTORY, tooling, output });

        assertEqual(failure, await catchRejection(command.run({}, {})));
        assertEqual(0, output.chunks.length);
    });
});
