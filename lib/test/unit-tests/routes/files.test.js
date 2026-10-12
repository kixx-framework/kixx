import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import routes from '../../../src/routes/files.js';

describe('Public file routes', ({ it }) => {
    it('reserves the stable file namespace for GET and HEAD', () => {
        assertEqual('/files/:fileId', routes[0].pattern);
        assertEqual('files', routes[0].name);
        assertEqual('GET,HEAD', routes[0].targets[0].methods.join(','));
    });
});
