'use strict';

// Starting baseline:
// --- Results ---
// Object length          : 2291
// clone() time (ms)      : 4039
// deepFreeze() time (ms) : 37
//
// With our new clone() on a much bigger object:
// --- Results ---
// Object length          : 6670
// clone() time (ms)      : 202
// deepFreeze() time (ms) : 246
//
// With some optimizations for clone() and deepFreeze():
// --- Results ---
// Object length          : 6670
// clone() time (ms)      : 186
// deepFreeze() time (ms) : 187

const Promise = require(`bluebird`);
const Filepath = require(`filepath`);
const zlib = require(`zlib`);
const {clone, deepFreeze} = require(`../library`);
const reportFullStackTrace = require(`../lib/report-full-stack-trace`);

const DATA_FILE_PATH = process.argv[2];

const file = Filepath.create(DATA_FILE_PATH);

if (!file.isFile()) {
	throw new Error(`Data file path is not a file: ${file}`);
}

function inflate(buff) {
	return new Promise((resolve, reject) => {
		zlib.inflate(buff, (err, buff) => {
			if (err) {
				return reject(err);
			}
			return resolve(buff);
		});
	});
}

function test(obj) {
	const startClone = Date.now();
	const foo = clone(obj);
	const cloneElapsedMs = Date.now() - startClone;
	const startFreeze = Date.now();
	deepFreeze(obj);
	const deepFreezeElapsedMs = Date.now() - startFreeze;
	const objectLength = foo.length;
	return {objectLength, cloneElapsedMs, deepFreezeElapsedMs};
}

function report(result) {
	/* eslint-disable no-console */
	console.log(`--- Results ---`);
	console.log(`Object length          :`, result.objectLength);
	console.log(`clone() time (ms)      :`, result.cloneElapsedMs);
	console.log(`deepFreeze() time (ms) :`, result.deepFreezeElapsedMs);
	/* eslint-enable */
}

file
	.read({encoding: null})
	.then(inflate)
	.then((text) => JSON.parse(text))
	.then(test)
	.then(report)
	.catch(reportFullStackTrace);
