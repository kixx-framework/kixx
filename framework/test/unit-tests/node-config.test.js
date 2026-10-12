import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import { readConfig } from '../../src/kixx/config/read-config.js';
import { readSourceConfigFile } from '../../src/node-environment.js';


const SRC_DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const sourceConfig = readSourceConfigFile(path.join(SRC_DIRECTORY, 'node-config.jsonc'));


describe('node-config local environment', ({ it }) => {

    it('passes readConfig', () => {
        const config = readConfig(sourceConfig, 'local', {
            resolveFilepath: (relativeFilepath) => relativeFilepath,
        });

        assertEqual('local', config.environment);
    });

    it('lists every top-level section the other environments have', () => {
        const local = sourceConfig.environments.local;
        const production = sourceConfig.environments.production;

        for (const section of Object.keys(production)) {
            assert(
                Object.hasOwn(local, section),
                `expected local environment to define ${ section }`,
            );
        }
    });

    it('uses instance-relative store paths', () => {
        const local = sourceConfig.environments.local;

        assertEqual('./document_store.sqlite', local.DOCUMENT_STORE.path);
        assertEqual('./key_value_store.sqlite', local.KEY_VALUE_STORE.path);
        assertEqual('./job_queue.sqlite', local.JOB_QUEUE.path);
        assertEqual('./object_store', local.OBJECT_STORE.path);
        assertEqual('./content_store', local.CONTENT_STORE.rootDirectory);
    });
});
