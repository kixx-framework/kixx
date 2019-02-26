'use strict';

const Task = require('./atypes/task');
const U = require('./utils');


exports.initializeComponents = U.curry(function initializeComponents(reducer, rootComponentName, componentMap, seed) {
	const reduceContext = U.curry(function reduceContext(reducer, initialize, context) {
		return U.map(
			U.reduce(reducer, context),
			U.map(U.toArray, initialize(context))
		);
	});

	function loadComponent(task, name) {
		const { initialize, dependencies } = componentMap.get(name);
		console.log(`SETUP: ${name} [${dependencies.join()}]`);

		if (dependencies && dependencies.length > 0) {
			task = dependencies.reduce(loadComponent, task);
		}

		return task.chain(reduceContext(reducer, initialize));
	}

	return loadComponent(Task.of(seed), rootComponentName);
});


exports.initializer = function initializer(fn) {
	let res;

	return function initializeComponent(context) {
		if (res) return res;

		try {
			res = fn(context);
		} catch (err) {
			res = Task.reject(err);
		}

		if (Task.isTask(res)) {
			return res;
		}

		res = Task.of(res);
		return res;
	};
};


exports.component = U.curry(function component(wrapper, name, dependencies, initialize) {
	initialize = wrapper(initialize);
	return { name, dependencies, initialize };
});


exports.initializeContext = U.curry(function initializeContext(reducer, rootComponentName, context, components) {
	const componentMap = components.reduce((cmap, comp) => {
		const { name } = comp;
		return cmap.set(name, comp);
	}, new Map());

	return exports.initializeComponents(reducer, rootComponentName, componentMap, context);
});

