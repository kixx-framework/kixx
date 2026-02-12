// NOTE: In a real Kixx application, you would import from 'kixx'
// import { ValidationError, isUndefined } from 'kixx';
// For testing within the framework repository, we use a relative path
import { ValidationError } from '../../../lib/errors/mod.js';
import { isUndefined } from '../../../lib/assertions/mod.js';

export default class NewTicketForm {

    target = 'CreateNewTicket';

    fields = [
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
        {
            fieldType: 'textarea',
            name: 'description',
            label: 'Description',
            schema: {
                type: 'string',
            },
        },
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
        {
            fieldType: 'multiSelect',
            name: 'components',
            label: 'Components',
            schema: {
                type: 'string',
                enum: [ 'component1', 'component2', 'component3' ],
            },
        },
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
        {
            fieldType: 'text',
            name: 'tags',
            label: 'Tags',
            schema: {
                type: 'string',
            },
        },
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

    #context = null; // eslint-disable-line no-unused-private-class-members
    #logger = null; // eslint-disable-line no-unused-private-class-members

    constructor(context) {
        this.#context = context;
        this.#logger = context.logger.createChild(this.constructor.name);
    }

    getField(name) {
        return this.fields.find((field) => field.name === name);
    }

    setFormData(formData) {
        const verror = new ValidationError('NewTicketForm validation error');

        for (const field of this.fields) {
            const { name, label, schema } = field;

            // Assign value from formData if the key exists
            if (Object.hasOwn(formData, name)) {
                const rawValue = formData[name];

                // Special case: tags field - split by spaces into array
                if (name === 'tags') {
                    field.value = rawValue.split(' ').filter(Boolean);
                } else if (schema.type === 'number') {
                    field.value = Number(rawValue);
                } else if (schema.type === 'array') {
                    field.value = Array.isArray(rawValue) ? rawValue : [ rawValue ];
                } else {
                    field.value = rawValue;
                }
            }

            // Validate required fields
            if (field.required && (isUndefined(field.value) || field.value === '')) {
                verror.push(`${ label } is required`, name);
                continue;
            }

            // Skip further validation if no value was assigned
            if (isUndefined(field.value)) {
                continue;
            }

            const { value } = field;

            // String validations
            if (schema.type === 'string') {
                if (schema.minLength !== undefined && value.length < schema.minLength) {
                    verror.push(`${ label } must be at least ${ schema.minLength } characters`, name);
                }
                if (schema.maxLength !== undefined && value.length > schema.maxLength) {
                    verror.push(`${ label } must be at most ${ schema.maxLength } characters`, name);
                }
                if (schema.enum && !schema.enum.map(String).includes(String(value))) {
                    verror.push(`${ label } must be one of: ${ schema.enum.join(', ') }`, name);
                }
            }

            // Number validations
            if (schema.type === 'number') {
                if (schema.minimum !== undefined && value < schema.minimum) {
                    verror.push(`${ label } must be at least ${ schema.minimum }`, name);
                }
                if (schema.maximum !== undefined && value > schema.maximum) {
                    verror.push(`${ label } must be at most ${ schema.maximum }`, name);
                }
            }

            // Array validations
            if (schema.type === 'array') {
                if (schema.minItems !== undefined && value.length < schema.minItems) {
                    verror.push(`${ label } must have at least ${ schema.minItems } items`, name);
                }
                if (schema.items && schema.items.enum) {
                    for (const item of value) {
                        if (!schema.items.enum.map(String).includes(String(item))) {
                            verror.push(`${ label } contains an invalid value: ${ item }`, name);
                            break;
                        }
                    }
                }
            }
        }

        if (verror.length > 0) {
            throw verror;
        }
    }
}
