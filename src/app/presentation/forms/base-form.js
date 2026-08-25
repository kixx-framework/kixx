import { assert, isString } from '../../../kixx/assertions/mod.js';

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
     * @param {import('../../../kixx/context/request-context.js').default} context - Current request context.
     * @param {import('../../../kixx/errors/lib/validation-error.js').default|string|null} [error] -
     * ValidationError from validate(), domain error code string, or null.
     * @returns {FormRenderContext} Form context for template rendering.
     * @throws {AssertionError} When the subclass target is missing or not registered,
     * or dynamic metadata names a field the schema does not declare.
     */
    getFormContext(context, error) {
        const properties = this.constructor.schema.properties;
        const dynamicMetadata = this.getDynamicFieldMetadata(context) ?? {};
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

        // A metadata key naming an undeclared field is a subclass mistake which
        // would otherwise render as a silently missing control.
        for (const name of Object.keys(dynamicMetadata)) {
            assert(
                Object.hasOwn(properties, name),
                `Dynamic field metadata for undeclared ${ this.constructor.name } field "${ name }"`,
            );
        }

        for (const [ name, field ] of Object.entries(properties)) {
            // Dynamic metadata overrides the static schema, but is applied before
            // the value and error below, so a subclass cannot defeat the writeOnly
            // omission or clobber a field error.
            fields[name] = Object.assign({}, field, dynamicMetadata[name], { name });

            if (field.writeOnly === true) {
                // A submitted secret is never echoed back into a re-rendered
                // form, including through a value dynamic metadata supplied.
                delete fields[name].value;
            } else {
                fields[name].value = this[name];
            }

            if (fieldErrors.has(name)) {
                fields[name].error = fieldErrors.get(name);
            } else {
                delete fields[name].error;
            }
        }

        const target = context.getHttpTarget(this.constructor.target);

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
     * Returns render metadata which cannot be declared statically in the schema,
     * keyed by field name and merged over the schema metadata by getFormContext().
     *
     * Override this instead of getFormContext() when a field's metadata is
     * resolved at request time — the canonical case is a `select` whose `options`
     * come from a registry, so the rendered choices cannot drift from what the
     * Transaction Script accepts. Overriding this hook rather than the render
     * method keeps action-URL compilation, per-field errors, and the `writeOnly`
     * value omission out of a subclass's reach.
     *
     * This hook is synchronous. When the metadata requires I/O, load it in the
     * request handler, assign it to the form instance, and read it from `this`
     * here.
     *
     * @param {import('../../../kixx/context/request-context.js').default} _context - Current request context.
     * @returns {Object<string, Object>|null} Partial field metadata keyed by declared field name, or null.
     */
    getDynamicFieldMetadata(_context) {
        return null;
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
     * @returns {BaseForm} Instance of the subclass this was called on, hydrated from the submitted fields.
     */
    static fromFormData(formData) {
        const Form = this;
        const attributes = Object.fromEntries(formData.entries());
        return new Form(attributes);
    }
}
