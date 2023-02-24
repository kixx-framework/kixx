export function createTemplateStore({ templateEngine }) {
	return {
		initialize() {
			return templateEngine.initialize();
		},

		getTemplate(id) {
			return templateEngine.getTemplate(id);
		},
	};
}
