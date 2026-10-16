import process from 'node:process';
import { canConnect as defaultCanConnect } from '../../lib/devserver/app-process.js';
import { TARGET_OPTION, createLocalLog } from '../../lib/local/command-support.js';
import { listInstances, resolveInstancesDirectory } from '../../lib/local/instance-store.js';


export default class LocalListCommand {

    static description = 'List the local instances in the target with their port, seeded state, and running state';

    static options = {
        target: TARGET_OPTION,
    };

    #projectDirectory;
    #output;
    #canConnect;

    constructor(args) {
        const {
            projectDirectory,
            output = process.stdout,
            canConnect = defaultCanConnect,
        } = args ?? {};

        this.#projectDirectory = projectDirectory;
        this.#output = output;
        this.#canConnect = canConnect;
    }

    async run(options) {
        const instancesDirectory = resolveInstancesDirectory({
            sourceDirectory: this.#projectDirectory,
            target: options?.target,
        });

        const instances = await listInstances({ instancesDirectory });

        if (instances.length === 0) {
            createLocalLog(this.#output)(`No local instances in ${ instancesDirectory }`);
            return 0;
        }

        const rows = [ [ 'NAME', 'PORT', 'SEEDED', 'RUNNING' ] ];

        for (const { name, port, isSeeded } of instances) {
            // eslint-disable-next-line no-await-in-loop
            const isRunning = port === null ? null : await this.#canConnect(port);

            rows.push([
                name,
                port === null ? '-' : String(port),
                yesNo(isSeeded),
                isRunning === null ? '-' : yesNo(isRunning),
            ]);
        }

        this.#output.write(formatTable(rows));

        return 0;
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
