import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import sourceConfig from '../../src/node-config.js';
import { readConfig } from '../../src/kixx/config/read-config.js';


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
        assertEqual('./object_store', local.OBJECT_STORE.path);
        assertEqual('./content_store', local.CONTENT_STORE.rootDirectory);
    });
});
