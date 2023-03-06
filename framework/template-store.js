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

    initialize(appContext) {
        return this.templateEngine.initialize(appContext).then(() => {
            return this;
        });
    }

    getTemplate(id) {
        return this.templateEngine.getTemplate(id);
    }
}
