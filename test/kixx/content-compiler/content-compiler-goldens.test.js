import { describe } from 'kixx-test';

import { compileContent, createMemoryContentSource } from '../../../kixx/content-compiler/mod.js';
import contentCompilerGoldens from './content-compiler-goldens.js';


describe('content-compiler goldens', ({ describe: group }) => {
    contentCompilerGoldens(group, () => {
        return { compileContent, createMemoryContentSource };
    });
});
