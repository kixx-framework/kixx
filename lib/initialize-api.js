'use strict';

const Task = require('./atypes/task');
const U = require('./utils');


exports.initializer = function initializer(name, fn) {
	let res;

	return function initializeComponent(api) {
		if (res) return res;
		res = fn(api);

		if (Task.isTask(res)) {
			return res;
		}

		res = Task.of(res);
		return res;
	};
};


exports.component = U.curry(function createComponent(wrapper, name, dependencies, initialize) {
	return {
		name,
		dependencies,
		initialize: wrapper(name, initialize)
	};
});


exports.initializeApi = U.curry(function initializeApi(rootCompName, api, components) {
	const componentMap = components.reduce((cmap, c) => {
		return cmap.set(c.name, c);
	}, new Map());

	function chainComponents(task, key) {
		const { dependencies, initialize } = componentMap.get(key);

		if (Array.isArray(dependencies) && dependencies.length > 0) {
			task = dependencies.reduce(chainComponents, task);
		}

		return task.chain(initialize);
	}

	return chainComponents(Task.of(api), rootCompName);
});

// ---


// exports.linkChain = LIB.reduce((c, fn) => {
// 	return c.chain(fn);
// });

// exports.initializer = function initializer(fn) {
// 	let res;

// 	return function initializeComponent(api) {
// 		if (res) return res;

// 		try {
// 			res = fn(api);
// 		} catch (err) {
// 			res = Task.reject(err);
// 			return res;
// 		}

// 		if (isTask(res)) return res;

// 		return Task.from(res);
// 	};
// };

// exports.component = LIB.curry(function component(name, dependencies, initialize) {
// 	return {
// 		name,
// 		dependencies,
// 		initialize: exports.initializer(initialize)
// 	};
// });

// function initialize(api) {
// 	if (!isAPI(api)) {
// 		return Task.reject(new Error(
// 			`Invalid API passed into '${name}' component`
// 		));
// 	}
// }


// function (api, componentArray) {
// 	// Convert an Array of components to a Map.
// 	const componentMap = componentArray.reduce((cm, c) => {
// 		return cm.set(c.name, c);
// 	}, new Map());

// 	function loadComponent(comp) {
// 		const { name, dependencies, initialize } = comp;

// 		if (Array.isArray(dependencies) && dependencies.length > 0) {
// 		}
// 	}
// }


// function memoizeInitializer(fn) {
// 	let res;
// 	return function (api) {
// 		if (res) {
// 			return res;
// 		}
// 		res = fn(api);
// 		return res;
// 	};
// }

// function execChain(list, a) {
// 	return list.reduce((t, fn) => {
// 		return t.chain(fn);
// 	}, Task.of(a));
// }

// const jan = memoizeInitializer((api) => {
// 	console.log('jan - start', api);
// 	return Task.of({ count: api.count + 1, id: 'jan' });
// });

// const feb = memoizeInitializer((api) => {
// 	console.log('feb - start', api);
// 	return Maybe.just({ count: api.count + 1, id: 'feb' });
// });

// const mar = memoizeInitializer((api) => {
// 	console.log('mar - start', api);
// 	return Task.of({ count: api.count + 1, id: 'mar' });
// });

// const apr = memoizeInitializer((api) => {
// 	console.log('apr - start', api);
// 	return Task.of({ count: api.count + 1, id: 'apr' });
// });

// const may = memoizeInitializer((api) => {
// 	console.log('may - start', api);
// 	return Task.of({ count: api.count + 1, id: 'may' });
// });


// function reportError(err) {
// 	console.log('Reporting Error:');
// 	console.log(err.stack);
// }


// console.log('--- compose 1 ---');
// const t1 = execChain([ jan, feb, mar, apr, may ], { count: 0, id: 'null' });

// console.log('--- compose 2 ---');
// const t2 = execChain([ jan, feb, mar, apr, may ].reverse(), { count: 0, id: 'null' });

// console.log('--- compose 3 ---');
// const t3 = execChain([ apr, jan, feb, apr, mar, jan, feb, may, may ], { count: 0, id: 'null' });

// t1.fork(reportError, (r) => {
// 	console.log('t1.fork =>', r);
// });

// t2.fork(reportError, (r) => {
// 	console.log('t2.fork =>', r);
// });

// t3.fork(reportError, (r) => {
// 	console.log('t3.fork =>', r);
// });

