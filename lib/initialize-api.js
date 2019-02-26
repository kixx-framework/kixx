'use strict';

const Task = require('./atypes/task');
const U = require('./utils');


exports.initializeComponents = U.curry(function initializeComponents(rootComponentName, componentMap, seed) {
	function loadComponent(task, name) {
		const { initialize, dependencies } = componentMap.get(name);
		console.log(`SETUP: ${name} [${dependencies.join()}]`);

		if (dependencies && dependencies.length > 0) {
			task = dependencies.reduce(loadComponent, task);
		}

		function mapContextState(context) {
			return initialize(context).map((res) => {
				const [ name, deps ] = res;
				return context.update(name, deps);
			});
		}

		return task.chain((context) => {
			return mapContextState(context);
		});
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


exports.initializeApi = U.curry(function initializeApi(rootComponentName, context, components) {
	const componentMap = components.reduce((cmap, comp) => {
		const { name } = comp;
		return cmap.set(name, comp);
	}, new Map());

	return exports.initializeComponents(rootComponentName, componentMap, context);
});

