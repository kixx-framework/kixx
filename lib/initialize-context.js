'use strict';

const Task = require('./atypes/task');
const U = require('./utils');


exports.flattenAndSerializeComponents = function flattenAndSerializeComponents(rootComponentName, list) {
	const lookupMap = list.reduce((cmap, comp) => {
		const { name } = comp;
		return cmap.set(name, comp);
	}, new Map());

	// const index = {};

	function flatten(components, name) {
		// if (index[name]) return components;
		const { initialize, dependencies } = lookupMap.get(name);

		if (dependencies && dependencies.length > 0) {
			components = dependencies.reduce(flatten, components);
		}

		// index[name] = true;
		components.push(initialize);
		return components;
	}

	return flatten([], rootComponentName);
};


exports.initializer = function (name, dependencies, fn) {
	return function initializeComponent(context) {
		let component;

		try {
			component = fn(context);
		} catch (err) {
			return Task.reject(err);
		}

		if (Task.isTask(component)) {
			return component.map((comp) => [ context, comp ]);
		}

		return Task.of([ context, component ]);
	};
};


exports.component = U.curry(function (wrapper, name, dependencies, initialize) {
	initialize = wrapper(name, dependencies, initialize);
	return [ name, dependencies, initialize ];
});


exports.contextReducer = U.curry(function (reducer, contextTask, initialize) {
	return contextTask.chain(initialize).map(([ context, component ]) => {
		return reducer(context, component);
	});
});


// Instead, just call:
//
//   reduce(reducer, contextTask, components);
//
// exports.initializeContext = U.curry(function (reducer, context, components) {
// 	return components.reduce(reducer, context);
// });
