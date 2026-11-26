import { describe } from 'kixx-test';

import { classifyPath, computeCodeFingerprint } from '../../../kixx/code-fingerprint/mod.js';
import codeFingerprintGoldens from './code-fingerprint-goldens.js';


describe('code-fingerprint goldens', ({ describe: group }) => {
    codeFingerprintGoldens(group, () => {
        return { computeCodeFingerprint, classifyPath };
    });
});
