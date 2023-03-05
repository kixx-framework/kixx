// @ts-check

export default class TemplateStore {

    templateEngine;

    constructor({ templateEngine }) {
        Object.defineProperties(this, {
            templateEngine: {
                enumerable: true,
                value: templateEngine,
            },
        });
    }

    initialize() {
        return this.templateEngine.initialize().then(() => {
            return this;
        });
    }

    getTemplate(id) {
        return this.templateEngine.getTemplate(id);
    }
}
