export default class TemplateWrapper {

    constructor(hash) {
        this.hash = hash;
        this.template = null;
        this.partials = new Map();
    }

    applyPartials(globalPartials, pagePartials) {
        // Remove keys that don't exist in page or global partials.
        this.partials.clear();

        // Add global partials first.
        for (const [key, value] of globalPartials) {
            this.partials.set(key, value);
        }

        // Then, overwrite with page partials
        for (const [key, value] of pagePartials) {
            this.partials.set(key, value);
        }

        return this;
    }
}
