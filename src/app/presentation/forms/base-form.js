import { assert, isString } from '../../kixx/assertions/mod.js';

/**
 * @typedef {Object} FormRenderContext
 * @property {string} name - Form class name.
 * @property {string} method - HTTP method for browser form submissions.
 * @property {string} url - Compiled form action pathname.
 * @property {string|null} errorCode - Field error marker, domain error code, or null.
 * @property {Object<string, Object>} fields - Schema fields keyed by name, with
 * current value and optional error message.
 */

/**
 * Base class for HTML forms rendered by Hyperview templates.
 *
 * Subclasses define static `target`, `method`, and `schema` properties, then
 * assign normalized field values on the instance before validation or rendering.
 */
export default class BaseForm {

    /**
     * Builds template render data from the form schema, instance values, and optional
     * error state.
     * @param {import('../../kixx/context/request-context.js').default} context - Current request context.
     * @param {import('../../kixx/errors/lib/validation-error.js').default|string|null} [error] -
     * ValidationError from validate(), domain error code string, or null.
     * @returns {FormRenderContext} Form context for template rendering.
     * @throws {import('../../kixx/assertions/mod.js').AssertionError} When the subclass
     * target is missing or not registered.
     */
    getFormContext(context, error) {
        const fields = {};
        const fieldErrors = new Map();

        let errorCode = null;

        if (error && error.name === 'ValidationError' && Array.isArray(error.errors)) {
            errorCode = 'field_error';
            for (const { message, source } of error.errors) {
                fieldErrors.set(source, message);
            }
        } else if (isString(error)) {
            errorCode = error;
        }

        for (const [ name, field ] of Object.entries(this.constructor.schema.properties)) {
            fields[name] = Object.assign({}, field, { name });

            if (field.writeOnly !== true) {
                fields[name].value = this[name];
            }

            if (fieldErrors.has(name)) {
                fields[name].error = fieldErrors.get(name);
            }
        }

        const target = context.getHttpTarget(this.constructor.target);

        assert(target, `missing HTTP target "${ this.constructor.target }"`);

        return {
            name: this.constructor.name,
            method: this.constructor.method,
            // The form instance carries any route params needed to hydrate the
            // HttpRoute pattern.
            url: target.compilePathname(this).pathname,
            errorCode,
            fields,
        };
    }

    /**
     * Creates the current form subclass from submitted browser FormData.
     *
     * The default parser treats each field as a scalar value. If FormData contains
     * duplicate field names, the last submitted value wins. Subclasses with
     * multi-value controls, file inputs, or array-typed schema fields should
     * override this method and read those fields explicitly with FormData APIs
     * such as getAll().
     *
     * @param {FormData} formData - Submitted browser form data.
     * @returns {BaseForm} Form subclass instance hydrated from the submitted fields.
     */
    static fromFormData(formData) {
        const Form = this;
        const attributes = Object.fromEntries(formData.entries());
        return new Form(attributes);
    }
}
