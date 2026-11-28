import path from 'node:path';
import process from 'node:process';


export default class GenerateCommand {

    static description = `
        Rewrite the project's generated files from its manifests: the
        registries, the routes, and example.env.secrets. Run it after you
        change kixx/plugin.json, a plugin's plugin.json, or app/app.json, and
        commit what it writes.
    `;

    static requiresTooling = true;

    #projectDirectory;
    #tooling;
    #output;

    constructor(args) {
        const {
            projectDirectory,
            tooling,
            output = process.stdout,
        } = args ?? {};

        this.#projectDirectory = projectDirectory;
        this.#tooling = tooling;
        this.#output = output;
    }

    async run() {
        const { tooling, createProjectFileSystem } = this.#tooling;

        // The generator is the project's own, so the files match the Kixx
        // version the project runs. It renders every file before it writes
        // any: an invalid manifest throws and leaves the project as it was.
        const files = await tooling.writeProjectFiles({
            fileSystem: createProjectFileSystem(this.#projectDirectory),
        });

        for (const fileName of files) {
            this.#output.write(`wrote ${ path.join(this.#projectDirectory, fileName) }\n`);
        }

        return { projectDirectory: this.#projectDirectory, files: [ ...files ] };
    }
}
