import { minimatch } from '../lib/vendor/mod.js';

const { Minimatch } = minimatch;

let pattern;
let glob;
let pathname;

pattern = '**/*.js';

glob = new Minimatch(pattern, {
    // We want to match filenames that begin with a dot:
    // example `a/**/b` should match `a/.d/b`
    dot: true,
});

pathname = 'lib/lib/urn-pattern-to-regexp.js';
console.log('#pattern', pattern, '#pathname', pathname, glob.match(pathname)); // true
