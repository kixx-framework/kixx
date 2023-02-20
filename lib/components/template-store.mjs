export function createTemplateStore({ templateEngine }) {
	return {
		getTemplate(id) {
			return templateEngine.getTemplate(id);
		},
	};
}
