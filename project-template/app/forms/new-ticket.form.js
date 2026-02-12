// NOTE: In a real Kixx application, you would import from 'kixx'
// import { ValidationError, isUndefined } from 'kixx';
// For testing within the framework repository, we use a relative path
import { ValidationError } from '../../../lib/errors/mod.js';
import { isUndefined } from '../../../lib/assertions/mod.js';

/**
 * @typedef {Object} FormField
 * @property {string} fieldType - HTML field type: 'text', 'textarea', 'number', 'singleSelect', 'multiSelect', 'checkboxList', 'radioList'
 * @property {string} name - Field name used as the form input name attribute
 * @property {string} label - Human-readable field label
 * @property {boolean} [required] - Whether the field must have a value
 * @property {Array<Object>} [options] - Options for select/radio/checkbox fields
 * @property {Object} schema - Validation schema for the field
 * @property {*} [value] - Current field value (set by setFormData)
 */

/**
 * Example form class for creating new support tickets.
 *
 * This form demonstrates:
 * - Field definitions with various input types (text, textarea, select, etc.)
 * - Schema-based validation with custom rules
 * - Type coercion for numbers and arrays
 * - Error aggregation using ValidationError
 * - Field value management
 *
 * Form classes in Kixx applications typically:
 * 1. Define a `target` which associates this form with a specific HTTP route target
 * 2. Define a `fields` array with field configurations and schemas
 * 3. Implement `setFormData()` to validate and normalize submitted data
 * 4. Optionally implement helper methods like `getField()`
 */
export default class NewTicketForm {

    /**
     * Form target identifier used by the framework to associate this form
     * with a specific HTTP route target.
     * @type {string}
     */
    target = 'Dashboard/Tickets/CreateNewTicket';

    /**
     * Field definitions array configuring all form inputs, their validation rules,
     * and display properties. Each field object defines the input type, validation
     * schema, and options for select/radio/checkbox fields.
     * @type {Array<FormField>}
     */
    fields = [
        // Text field: Basic single-line text input
        // Required field with length constraints
        {
            fieldType: 'text',
            name: 'title',
            label: 'Title',
            required: true,
            schema: {
                type: 'string',
                minLength: 2,
                maxLength: 80,
            },
        },
        // Textarea field: Multi-line text input
        // Optional field with no length constraints
        {
            fieldType: 'textarea',
            name: 'description',
            label: 'Description',
            schema: {
                type: 'string',
            },
        },
        // Single select field: Dropdown menu for one selection
        // Options define the choices, enum validates submitted values
        {
            fieldType: 'singleSelect',
            name: 'priority',
            label: 'Priority',
            options: [
                { value: 3, label: 'Low' },
                { value: 2, label: 'Medium' },
                { value: 1, label: 'High' },
            ],
            schema: {
                type: 'string',
                enum: [ 3, 2, 1 ],
            },
        },
        // Multi-select field: Allows selecting multiple options
        // No options array means the UI will generate from enum values
        {
            fieldType: 'multiSelect',
            name: 'components',
            label: 'Components',
            schema: {
                type: 'string',
                enum: [ 'component1', 'component2', 'component3' ],
            },
        },
        // Checkbox list field: Multiple checkboxes for array of values
        // Requires at least one selection via minItems constraint
        {
            fieldType: 'checkboxList',
            name: 'domains',
            label: 'Domains',
            options: [
                { value: 'domain1', label: 'Domain 1' },
                { value: 'domain2', label: 'Domain 2' },
                { value: 'domain3', label: 'Domain 3' },
            ],
            schema: {
                type: 'array',
                minItems: 1, // Require at least one item to be selected
                items: {
                    type: 'string',
                    enum: [ 'domain1', 'domain2', 'domain3' ],
                },
            },
        },
        // Radio list field: Multiple radio buttons for single selection
        // Similar to singleSelect but uses radio buttons instead of dropdown
        {
            fieldType: 'radioList',
            name: 'status',
            label: 'Status',
            required: true,
            options: [
                { value: 'status1', label: 'Status 1' },
                { value: 'status2', label: 'Status 2' },
                { value: 'status3', label: 'Status 3' },
            ],
            schema: {
                type: 'string',
                enum: [ 'status1', 'status2', 'status3' ],
            },
        },
        // Text field with custom parsing: Demonstrates special handling in setFormData
        // This field splits space-separated input into an array
        {
            fieldType: 'text',
            name: 'tags',
            label: 'Tags',
            schema: {
                type: 'string',
            },
        },
        // Number field: Numeric input with range constraints
        // Automatically coerced to number type in setFormData
        {
            fieldType: 'number',
            name: 'estimatedHours',
            label: 'Estimated Hours',
            schema: {
                type: 'number',
                minimum: 0,
                maximum: 100,
            },
        },
    ];

    /**
     * Request context reference for accessing services and configuration.
     * Stored for potential use in custom validation or field population logic.
     * @type {RequestContext}
     */
    #context = null; // eslint-disable-line no-unused-private-class-members

    /**
     * Child logger named after the class for easy identification in logs.
     * @type {Logger}
     */
    #logger = null; // eslint-disable-line no-unused-private-class-members

    /**
     * Creates a new form instance with application context
     * @param {RequestContext} context - Request context with configuration, services, and logging
     */
    constructor(context) {
        this.#context = context;
        // Create child logger to namespace log entries under "NewTicketForm"
        this.#logger = context.logger.createChild(this.constructor.name);
    }

    /**
     * Retrieves a field definition by its name
     *
     * Useful for accessing field metadata, options, or current values in request
     * handlers or templates. Returns undefined if the field doesn't exist.
     *
     * @param {string} name - Field name to look up
     * @returns {FormField|undefined} Field definition object or undefined if not found
     *
     * @example
     * const titleField = form.getField('title');
     * console.log(titleField.value); // Access current value
     * console.log(titleField.label); // Access field label
     */
    getField(name) {
        return this.fields.find((field) => field.name === name);
    }

    /**
     * Validates and normalizes submitted form data
     *
     * This method performs several operations:
     * 1. Type coercion: Converts string inputs to appropriate types (number, array)
     * 2. Custom parsing: Handles special cases like space-separated tags
     * 3. Validation: Checks required fields, length constraints, numeric ranges, and enum values
     * 4. Error aggregation: Collects all validation errors into a single ValidationError
     *
     * If validation succeeds, field values are set on their respective field objects
     * and can be accessed via field.value. If validation fails, throws ValidationError
     * containing all validation messages keyed by field name.
     *
     * @param {Object} formData - Raw form data from HTTP request (typically from request.body)
     * @throws {ValidationError} When validation fails, contains all field-specific error messages
     *
     * @example
     * try {
     *   form.setFormData(request.body);
     *   // All fields are now validated and normalized
     *   const title = form.getField('title').value;
     * } catch (error) {
     *   if (error instanceof ValidationError) {
     *     // error.details contains field-specific errors
     *     response.renderForm(form, error);
     *   }
     * }
     */
    setFormData(formData) {
        // Create ValidationError to aggregate all validation failures
        // If any validation fails, we collect all errors before throwing
        const verror = new ValidationError('NewTicketForm validation error');

        // Process each field: assign values and validate
        for (const field of this.fields) {
            const { name, label, schema } = field;

            // Only process fields that were submitted in the form data
            // Missing optional fields will remain undefined
            if (Object.hasOwn(formData, name)) {
                const rawValue = formData[name];

                // Type coercion and normalization based on field type
                // Form data arrives as strings or arrays from HTTP request body
                if (name === 'tags') {
                    // Special case: tags field expects space-separated string
                    // Split into array and remove empty strings
                    field.value = rawValue.split(' ').filter(Boolean);
                } else if (schema.type === 'number') {
                    // Coerce string input to number type
                    field.value = Number(rawValue);
                } else if (schema.type === 'array') {
                    // Normalize to array: handle single value or multiple values
                    // Some HTML form encodings send single values as strings
                    field.value = Array.isArray(rawValue) ? rawValue : [ rawValue ];
                } else {
                    // String and other types: use raw value as-is
                    field.value = rawValue;
                }
            }

            // Validate required fields first
            // Empty string is treated as missing for required fields
            if (field.required && (isUndefined(field.value) || field.value === '')) {
                verror.push(`${ label } is required`, name);
                // Skip remaining validations - no point validating an empty required field
                continue;
            }

            // Skip validation for optional fields with no value
            // Undefined values are valid for non-required fields
            if (isUndefined(field.value)) {
                continue;
            }

            const { value } = field;

            // String validations: length and enum constraints
            if (schema.type === 'string') {
                // Check minimum length constraint
                if (schema.minLength !== undefined && value.length < schema.minLength) {
                    verror.push(`${ label } must be at least ${ schema.minLength } characters`, name);
                }
                // Check maximum length constraint
                if (schema.maxLength !== undefined && value.length > schema.maxLength) {
                    verror.push(`${ label } must be at most ${ schema.maxLength } characters`, name);
                }
                // Check enum constraint: value must be in allowed list
                // Convert both sides to strings for comparison since form values may be coerced
                if (schema.enum && !schema.enum.map(String).includes(String(value))) {
                    verror.push(`${ label } must be one of: ${ schema.enum.join(', ') }`, name);
                }
            }

            // Number validations: range constraints
            if (schema.type === 'number') {
                // Check minimum value constraint
                if (schema.minimum !== undefined && value < schema.minimum) {
                    verror.push(`${ label } must be at least ${ schema.minimum }`, name);
                }
                // Check maximum value constraint
                if (schema.maximum !== undefined && value > schema.maximum) {
                    verror.push(`${ label } must be at most ${ schema.maximum }`, name);
                }
            }

            // Array validations: length and item constraints
            if (schema.type === 'array') {
                // Check minimum items constraint
                if (schema.minItems !== undefined && value.length < schema.minItems) {
                    verror.push(`${ label } must have at least ${ schema.minItems } items`, name);
                }
                // Validate each array item against enum constraint
                if (schema.items && schema.items.enum) {
                    for (const item of value) {
                        // Convert both sides to strings for comparison
                        if (!schema.items.enum.map(String).includes(String(item))) {
                            verror.push(`${ label } contains an invalid value: ${ item }`, name);
                            // Break after first invalid item to avoid duplicate errors
                            break;
                        }
                    }
                }
            }
        }

        // Throw ValidationError if any validation failures occurred
        // ValidationError.length returns the count of collected errors
        if (verror.length > 0) {
            throw verror;
        }

        // If we reach here, all validations passed
        // Field values are set and can be accessed via getField(name).value
    }
}
