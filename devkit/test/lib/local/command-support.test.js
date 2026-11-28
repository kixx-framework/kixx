import path from 'node:path';
import { describe } from 'kixx-test';
import { assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';
import { formatLocalCommand } from '../../../lib/local/command-support.js';


const CWD = path.resolve('/work');


describe('formatLocalCommand()', ({ it }) => {

    it('names the project directory relative to the working directory', () => {
        const text = formatLocalCommand({ command: 'start alpha', projectDirectory: path.join(CWD, 'app'), cwd: CWD });
        assertEqual('kixx-dev local start alpha app', text);
    });

    it('leaves the directory out from inside the project', () => {
        assertEqual('kixx-dev local start alpha', formatLocalCommand({ command: 'start alpha', projectDirectory: CWD, cwd: CWD }));
    });

    it('repeats --target as given', () => {
        const text = formatLocalCommand({ command: 'start alpha', projectDirectory: CWD, target: 'tmp/x', cwd: CWD });
        assertEqual('kixx-dev local start alpha --target tmp/x', text);
    });

    // Otherwise the value would be read as a flag.
    it('uses the = form for a --target that starts with a dash', () => {
        const text = formatLocalCommand({ command: 'start alpha', projectDirectory: CWD, target: '-v', cwd: CWD });
        assertEqual('kixx-dev local start alpha --target=-v', text);
    });
});
