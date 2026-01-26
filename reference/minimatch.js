import { minimatch } from '../lib/vendor/mod.js';

const { Minimatch } = minimatch;

/* eslint-disable no-console */

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

pathname = 'mod.js';
console.log('#pattern', pattern, '#pathname', pathname, glob.match(pathname)); // true

pattern = 'app/**/*.js';

glob = new Minimatch(pattern, {
    // We want to match filenames that begin with a dot:
    // example `a/**/b` should match `a/.d/b`
    dot: true,
});

pathname = 'app/plugin.js';
console.log('#pattern', pattern, '#pathname', pathname, glob.match(pathname)); // true

pathname = 'app/collections/user/user.model.js';
console.log('#pattern', pattern, '#pathname', pathname, glob.match(pathname)); // true

pathname = 'plugins/auth/plugin.js';
console.log('#pattern', pattern, '#pathname', pathname, glob.match(pathname)); // false
