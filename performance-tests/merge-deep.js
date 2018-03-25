/* eslint-disable no-console */
'use strict';

const Filepath = require('filepath');
const R = require('ramda');
const LIB = require('../library');

const OBJECT_COUNT = 5000;

const ramdaMerge = R.mergeDeepRight;
const kixxMerge = LIB.mergeDeep;

// Use package.json as random data generator.
const pkgFile = Filepath.create(__dirname).dir().append('package.json');

const objects = [];

pkgFile.read().then((text) => {
	console.log(`With ${OBJECT_COUNT} objects ...`);

	for (let i = OBJECT_COUNT - 1; i >= 0; i--) {
		const obj = JSON.parse(text);
		obj.list = R.range(0, 5).map(() => JSON.parse(text));
		obj.nested = JSON.parse(JSON.stringify(obj));
		objects.push(obj);
	}

	let start = Date.now();
	for (let i = objects.length - 1; i >= 0; i--) {
		ramdaMerge(objects[i], objects[i + 1] || {});
	}
	console.log('Ramda.mergeDeepRight() :', Date.now() - start);

	start = Date.now();
	for (let i = objects.length - 1; i >= 0; i--) {
		kixxMerge(objects[i], objects[i + 1]);
	}
	console.log('KixxLibrary.mergeDeep() :', Date.now() - start);

	return null;
}).catch((err) => {
	console.error(err.stack);
});
