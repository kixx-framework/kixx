'use strict';


const CONFIGS = [
	[ 'jan', [ 'mar' ] ],
	[ 'feb', [] ],
	[ 'mar', [ 'may', 'apr', 'feb' ] ],
	[ 'apr', [ 'feb', 'may' ] ],
	[ 'may', [] ]
];


const components = CONFIGS.map(([ name, dependencies ]) => {
	function init(x) {
		console.log('init', name, 'arg', x);
		const y = x.slice();
		y[0] = y[0] + 1;
		return y;
	}

	return {
		name,
		dependencies,
		init
	};
});


function initialize(components, rootKey) {
	const map = components.reduce((cmap, c) => {
		return cmap.set(c.name, c);
	}, new Map());

	function loadComponent(result, key) {
		const { name, dependencies, init } = map.get(key);
		console.log('chain', name);

		let promise = Promise.resolve(result);

		if (dependencies.length > 0) {
			promise = dependencies.reduce((p, key) => {
				return p.then((res) => {
					return loadComponent(res, key);
				});
			}, promise);
		}

		return promise.then(init);
	}

	return loadComponent(Promise.resolve([0]), rootKey);
}

initialize(components, 'jan');
