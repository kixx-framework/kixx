import { ProgrammerError } from 'kixx-server-errors';

export default class BaseComponent {
	#initializationStarted = false;

	setName(name) {
		Object.defineProperty(this, 'name', {
			enumerable: true,
			value: name,
		});
	}

	initialize(context) {
		if (this.#initializationStarted) {
			return Promise.reject(new ProgrammerError(`Component "${ this.name }" has already been initialized`));
		}

		this.#initializationStarted = true;

		return this.initializeComponent(context);
	}

	initializeComponent() {
		return Promise.resolve(this);
	}

	injectDependencies() {
	}

	static listDependencies() {
		return [];
	}
}
