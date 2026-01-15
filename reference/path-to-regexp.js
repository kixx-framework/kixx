import { PathToRegexp } from '../lib/vendor/mod.js';

/* eslint-disable no-console */

let pattern;
let matcher;
let url;

// Optional ".json" file extension
pattern = '/some-file-name{.json}';
matcher = PathToRegexp.match(pattern);

// Matches
url = '/some-file-name';
console.log('pattern:', pattern, 'url:', url, '=>', matcher(url));

// Matches
url = '/some-file-name.json';
console.log('pattern:', pattern, 'url:', url, '=>', matcher(url));

// Does NOT match
url = '/some-file-name.html';
console.log('pattern:', pattern, 'url:', url, '=>', matcher(url));

// Optional ".json" file extension the home directory
pattern = '/{index.:ext}';
matcher = PathToRegexp.match(pattern);

// Does NOT match
url = '/this-will-not-be-found';
console.log('pattern:', pattern, 'url:', url, '=>', matcher(url));

// Matches
url = '/';
console.log('pattern:', pattern, 'url:', url, '=>', matcher(url));

// Does NOT match
url = '/index';
console.log('pattern:', pattern, 'url:', url, '=>', matcher(url));

// Matches
url = '/index.json';
console.log('pattern:', pattern, 'url:', url, '=>', matcher(url));

// Matches
url = '/index.html';
console.log('pattern:', pattern, 'url:', url, '=>', matcher(url));

pattern = '/favicon{:filename}.:ext';
matcher = PathToRegexp.match(pattern);

// Matches
url = '/favicon.ico';
console.log('pattern:', pattern, 'url:', url, '=>', matcher(url));

// Matches
url = '/favicon-48x48.png';
console.log('pattern:', pattern, 'url:', url, '=>', matcher(url));

// Matches
url = '/favicon-apple-touch-icon.png';
console.log('pattern:', pattern, 'url:', url, '=>', matcher(url));

// Does NOT match
url = '/another-icon.ico';
console.log('pattern:', pattern, 'url:', url, '=>', matcher(url));

//
// Reconstruct a URL
//

pattern = '/api/v1/collections/:type{/:id}';
const toUrl = PathToRegexp.compile(pattern);

console.log('pattern:', pattern, ' to URL =>', toUrl({ type: 'product' }));
console.log('pattern:', pattern, ' to URL =>', toUrl({ type: 'product', id: 'foo-123' }));

//
// Match hostnames
//

pattern = 'com.example.:subdomain';
matcher = PathToRegexp.match(pattern);

url = 'com.example.www';
console.log('pattern:', pattern, 'url:', url, '=>', matcher(url));

pattern = 'com.:domain.:subdomain';
matcher = PathToRegexp.match(pattern);

url = 'com.example.www';
console.log('pattern:', pattern, 'url:', url, '=>', matcher(url));

pattern = 'com.:domain{.:subdomain}';
matcher = PathToRegexp.match(pattern);

url = 'com.example.www';
console.log('pattern:', pattern, 'url:', url, '=>', matcher(url));

url = 'com.example';
console.log('pattern:', pattern, 'url:', url, '=>', matcher(url));
