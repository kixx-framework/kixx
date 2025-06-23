import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Paths from '../../../application/paths.js';
import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';


const thisDirectory = path.dirname(fileURLToPath(import.meta.url));


describe('Paths.fromConfigFilepath()', ({ it }) => {
    it('uses the directory of the config file', () => {
        const paths = Paths.fromConfigFilepath(path.join(thisDirectory, 'config.json'));
        assertEqual(thisDirectory, paths.app_directory);
    });
});
