import process from 'node:process';
import { canConnect as defaultCanConnect } from '../../lib/devserver/app-process.js';
import { TARGET_OPTION, createLocalLog } from '../../lib/local/command-support.js';
import { listInstances, resolveInstancesDirectory } from '../../lib/local/instance-store.js';


export default class LocalListCommand {

    static description = 'List the local instances in the target with their port, seeded state, and running state';

    static requiresProject = true;

    static options = {
        target: TARGET_OPTION,
    };

    #projectDirectory;
    #cwd;
    #output;
    #canConnect;

    constructor(args) {
        const {
            projectDirectory,
            cwd = process.cwd(),
            output = process.stdout,
            canConnect = defaultCanConnect,
        } = args ?? {};

        this.#projectDirectory = projectDirectory;
        this.#cwd = cwd;
        this.#output = output;
        this.#canConnect = canConnect;
    }

    async run(options) {
        const instancesDirectory = resolveInstancesDirectory({
            sourceDirectory: this.#projectDirectory,
            cwd: this.#cwd,
            target: options?.target,
        });

        const instances = await listInstances({ instancesDirectory });

        if (instances.length === 0) {
            createLocalLog(this.#output)(`No local instances in ${ instancesDirectory }`);
            return { instances: [] };
        }

        const listed = [];

        for (const { name, port, isSeeded } of instances) {
            // An instance directory without readable metadata has no port,
            // so nothing says whether it is running.
            // eslint-disable-next-line no-await-in-loop
            const running = port === null ? null : await this.#canConnect(port);

            listed.push({ name, port, seeded: isSeeded, running });
        }

        const rows = [ [ 'NAME', 'PORT', 'SEEDED', 'RUNNING' ] ];

        for (const { name, port, seeded, running } of listed) {
            rows.push([
                name,
                port === null ? '-' : String(port),
                yesNo(seeded),
                running === null ? '-' : yesNo(running),
            ]);
        }

        this.#output.write(formatTable(rows));

        return { instances: listed };
    }
}


function yesNo(value) {
    return value ? 'yes' : 'no';
}

// Machine-shaped output, so it is not wrapped.
function formatTable(rows) {
    const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));

    const lines = rows.map((row) => {
        return row.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd();
    });

    return `${ lines.join('\n') }\n`;
}
