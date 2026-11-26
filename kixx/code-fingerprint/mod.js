/**
 * The code fingerprint: which paths of a project are code (D40), and one
 * versioned hash over a commit's code entries that every tool computes the
 * same way. It imports no platform module, so a command line tool and a
 * running app share it.
 * @module code-fingerprint
 */
export { PATH_CLASSES, classifyPath, createPathClassifier } from './classify-path.js';
