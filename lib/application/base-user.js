import { AssertionError, assertNonEmptyString } from '../assertions/mod.js';


export default class BaseUser {

    #context = null;

    constructor(context) {
        this.#context = context;
    }

    async saveFormData(formName, data) {
        assertNonEmptyString(formName, 'User#saveFormData() requires a formName string');
        const form = this.#context.getForm(formName);

        if (!form) {
            throw new AssertionError(`No form named "${ formName }"`, null, this.saveFormData);
        }

        // May throw a ValidationError
        await form.save(data);
    }
}
