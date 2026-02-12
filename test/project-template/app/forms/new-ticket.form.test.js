import { describe } from 'kixx-test';
import { assert, assertEqual, assertMatches } from 'kixx-assert';
import sinon from 'sinon';
import NewTicketForm from '../../../../project-template/app/forms/new-ticket.form.js';


function createMockContext() {
    return {
        logger: {
            createChild: sinon.stub().returns({
                debug: sinon.spy(),
                info: sinon.spy(),
                warn: sinon.spy(),
                error: sinon.spy(),
            }),
        },
    };
}


describe('NewTicketForm#constructor', ({ before, after, it }) => {
    let context;
    let form;

    before(() => {
        context = createMockContext();
        form = new NewTicketForm(context);
    });

    after(() => {
        sinon.restore();
    });

    it('creates a child logger with the class name', () => {
        assertEqual(1, context.logger.createChild.callCount);
        assertEqual('NewTicketForm', context.logger.createChild.firstCall.firstArg);
    });

    it('sets the target property', () => {
        assertEqual('Dashboard/Tickets/CreateNewTicket', form.target);
    });

    it('defines the fields array', () => {
        assert(Array.isArray(form.fields));
        assertEqual(8, form.fields.length);
    });
});


describe('NewTicketForm fields configuration', ({ before, it }) => {
    let form;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);
    });

    it('has title field configured correctly', () => {
        const field = form.fields.find((f) => f.name === 'title');
        assertEqual('text', field.fieldType);
        assertEqual('Title', field.label);
        assertEqual(true, field.required);
        assertEqual('string', field.schema.type);
        assertEqual(2, field.schema.minLength);
        assertEqual(80, field.schema.maxLength);
    });

    it('has description field configured correctly', () => {
        const field = form.fields.find((f) => f.name === 'description');
        assertEqual('textarea', field.fieldType);
        assertEqual('Description', field.label);
        assertEqual('string', field.schema.type);
    });

    it('has priority field configured correctly', () => {
        const field = form.fields.find((f) => f.name === 'priority');
        assertEqual('singleSelect', field.fieldType);
        assertEqual('Priority', field.label);
        assertEqual(3, field.options.length);
        assert(Array.isArray(field.schema.enum));
        assertEqual(3, field.schema.enum[0]);
        assertEqual(2, field.schema.enum[1]);
        assertEqual(1, field.schema.enum[2]);
    });

    it('has components field configured correctly', () => {
        const field = form.fields.find((f) => f.name === 'components');
        assertEqual('multiSelect', field.fieldType);
        assertEqual('Components', field.label);
        assertEqual('string', field.schema.type);
        assert(Array.isArray(field.schema.enum));
    });

    it('has domains field configured correctly', () => {
        const field = form.fields.find((f) => f.name === 'domains');
        assertEqual('checkboxList', field.fieldType);
        assertEqual('Domains', field.label);
        assertEqual('array', field.schema.type);
        assertEqual(1, field.schema.minItems);
        assertEqual('string', field.schema.items.type);
        assert(Array.isArray(field.schema.items.enum));
    });

    it('has status field configured correctly', () => {
        const field = form.fields.find((f) => f.name === 'status');
        assertEqual('radioList', field.fieldType);
        assertEqual('Status', field.label);
        assertEqual(true, field.required);
        assertEqual('string', field.schema.type);
        assert(Array.isArray(field.schema.enum));
    });

    it('has tags field configured correctly', () => {
        const field = form.fields.find((f) => f.name === 'tags');
        assertEqual('text', field.fieldType);
        assertEqual('Tags', field.label);
        assertEqual('string', field.schema.type);
    });

    it('has estimatedHours field configured correctly', () => {
        const field = form.fields.find((f) => f.name === 'estimatedHours');
        assertEqual('number', field.fieldType);
        assertEqual('Estimated Hours', field.label);
        assertEqual('number', field.schema.type);
        assertEqual(0, field.schema.minimum);
        assertEqual(100, field.schema.maximum);
    });
});


describe('NewTicketForm#getField() when field exists', ({ before, it }) => {
    let form;
    let field;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);
        field = form.getField('title');
    });

    it('returns the field object', () => {
        assert(field);
        assertEqual('title', field.name);
        assertEqual('Title', field.label);
    });
});


describe('NewTicketForm#getField() when field does not exist', ({ before, it }) => {
    let form;
    let result;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);
        result = form.getField('nonexistent');
    });

    it('returns undefined', () => {
        assertEqual(undefined, result);
    });
});


describe('NewTicketForm#setFormData() with valid data for all fields', ({ before, it }) => {
    let form;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        const formData = {
            title: 'Valid Title',
            description: 'A valid description',
            priority: 2,
            components: 'component1',
            domains: [ 'domain1', 'domain2' ],
            status: 'status1',
            tags: 'bug feature',
            estimatedHours: 10,
        };

        form.setFormData(formData);
    });

    it('sets title field value', () => {
        const field = form.getField('title');
        assertEqual('Valid Title', field.value);
    });

    it('sets description field value', () => {
        const field = form.getField('description');
        assertEqual('A valid description', field.value);
    });

    it('sets priority field value', () => {
        const field = form.getField('priority');
        assertEqual(2, field.value);
    });

    it('sets components field value', () => {
        const field = form.getField('components');
        assertEqual('component1', field.value);
    });

    it('sets domains field value as array', () => {
        const field = form.getField('domains');
        assert(Array.isArray(field.value));
        assertEqual(2, field.value.length);
        assertEqual('domain1', field.value[0]);
        assertEqual('domain2', field.value[1]);
    });

    it('sets status field value', () => {
        const field = form.getField('status');
        assertEqual('status1', field.value);
    });

    it('sets tags field value as array by splitting on spaces', () => {
        const field = form.getField('tags');
        assert(Array.isArray(field.value));
        assertEqual(2, field.value.length);
        assertEqual('bug', field.value[0]);
        assertEqual('feature', field.value[1]);
    });

    it('sets estimatedHours field value as number', () => {
        const field = form.getField('estimatedHours');
        assertEqual(10, field.value);
    });
});


describe('NewTicketForm#setFormData() when required title field is missing', ({ before, it }) => {
    let form;
    let error;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        try {
            form.setFormData({
                status: 'status1',
            });
        } catch (e) {
            error = e;
        }
    });

    it('throws a ValidationError', () => {
        assert(error);
        assertEqual('ValidationError', error.name);
        assertEqual('VALIDATION_ERROR', error.code);
    });

    it('includes title validation error', () => {
        assertEqual(1, error.length);
        assertEqual('Title is required', error.errors[0].message);
        assertEqual('title', error.errors[0].source);
    });
});


describe('NewTicketForm#setFormData() when required status field is missing', ({ before, it }) => {
    let form;
    let error;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        try {
            form.setFormData({
                title: 'Valid Title',
            });
        } catch (e) {
            error = e;
        }
    });

    it('throws a ValidationError', () => {
        assert(error);
        assertEqual('ValidationError', error.name);
    });

    it('includes status validation error', () => {
        assertEqual(1, error.length);
        assertEqual('Status is required', error.errors[0].message);
        assertEqual('status', error.errors[0].source);
    });
});


describe('NewTicketForm#setFormData() when required title field is empty string', ({ before, it }) => {
    let form;
    let error;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        try {
            form.setFormData({
                title: '',
                status: 'status1',
            });
        } catch (e) {
            error = e;
        }
    });

    it('throws a ValidationError', () => {
        assert(error);
        assertEqual('ValidationError', error.name);
    });

    it('includes title validation error', () => {
        assertEqual(1, error.length);
        assertEqual('Title is required', error.errors[0].message);
        assertEqual('title', error.errors[0].source);
    });
});


describe('NewTicketForm#setFormData() when title is too short', ({ before, it }) => {
    let form;
    let error;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        try {
            form.setFormData({
                title: 'x',
                status: 'status1',
            });
        } catch (e) {
            error = e;
        }
    });

    it('throws a ValidationError', () => {
        assert(error);
        assertEqual('ValidationError', error.name);
    });

    it('includes minLength validation error', () => {
        assertEqual(1, error.length);
        assertMatches('Title must be at least 2 characters', error.errors[0].message);
        assertEqual('title', error.errors[0].source);
    });
});


describe('NewTicketForm#setFormData() when title is too long', ({ before, it }) => {
    let form;
    let error;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        const longTitle = 'x'.repeat(81);

        try {
            form.setFormData({
                title: longTitle,
                status: 'status1',
            });
        } catch (e) {
            error = e;
        }
    });

    it('throws a ValidationError', () => {
        assert(error);
        assertEqual('ValidationError', error.name);
    });

    it('includes maxLength validation error', () => {
        assertEqual(1, error.length);
        assertMatches('Title must be at most 80 characters', error.errors[0].message);
        assertEqual('title', error.errors[0].source);
    });
});


describe('NewTicketForm#setFormData() when priority is invalid', ({ before, it }) => {
    let form;
    let error;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        try {
            form.setFormData({
                title: 'Valid Title',
                priority: 99,
                status: 'status1',
            });
        } catch (e) {
            error = e;
        }
    });

    it('throws a ValidationError', () => {
        assert(error);
        assertEqual('ValidationError', error.name);
    });

    it('includes enum validation error', () => {
        assertEqual(1, error.length);
        assertMatches('Priority must be one of:', error.errors[0].message);
        assertEqual('priority', error.errors[0].source);
    });
});


describe('NewTicketForm#setFormData() when status is invalid', ({ before, it }) => {
    let form;
    let error;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        try {
            form.setFormData({
                title: 'Valid Title',
                status: 'invalid_status',
            });
        } catch (e) {
            error = e;
        }
    });

    it('throws a ValidationError', () => {
        assert(error);
        assertEqual('ValidationError', error.name);
    });

    it('includes enum validation error', () => {
        assertEqual(1, error.length);
        assertMatches('Status must be one of:', error.errors[0].message);
        assertEqual('status', error.errors[0].source);
    });
});


describe('NewTicketForm#setFormData() when estimatedHours is below minimum', ({ before, it }) => {
    let form;
    let error;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        try {
            form.setFormData({
                title: 'Valid Title',
                status: 'status1',
                estimatedHours: -5,
            });
        } catch (e) {
            error = e;
        }
    });

    it('throws a ValidationError', () => {
        assert(error);
        assertEqual('ValidationError', error.name);
    });

    it('includes minimum validation error', () => {
        assertEqual(1, error.length);
        assertMatches('Estimated Hours must be at least 0', error.errors[0].message);
        assertEqual('estimatedHours', error.errors[0].source);
    });
});


describe('NewTicketForm#setFormData() when estimatedHours is above maximum', ({ before, it }) => {
    let form;
    let error;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        try {
            form.setFormData({
                title: 'Valid Title',
                status: 'status1',
                estimatedHours: 150,
            });
        } catch (e) {
            error = e;
        }
    });

    it('throws a ValidationError', () => {
        assert(error);
        assertEqual('ValidationError', error.name);
    });

    it('includes maximum validation error', () => {
        assertEqual(1, error.length);
        assertMatches('Estimated Hours must be at most 100', error.errors[0].message);
        assertEqual('estimatedHours', error.errors[0].source);
    });
});


describe('NewTicketForm#setFormData() when domains array is empty', ({ before, it }) => {
    let form;
    let error;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        try {
            form.setFormData({
                title: 'Valid Title',
                status: 'status1',
                domains: [],
            });
        } catch (e) {
            error = e;
        }
    });

    it('throws a ValidationError', () => {
        assert(error);
        assertEqual('ValidationError', error.name);
    });

    it('includes minItems validation error', () => {
        assertEqual(1, error.length);
        assertMatches('Domains must have at least 1 items', error.errors[0].message);
        assertEqual('domains', error.errors[0].source);
    });
});


describe('NewTicketForm#setFormData() when domains contains invalid value', ({ before, it }) => {
    let form;
    let error;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        try {
            form.setFormData({
                title: 'Valid Title',
                status: 'status1',
                domains: [ 'domain1', 'invalid_domain' ],
            });
        } catch (e) {
            error = e;
        }
    });

    it('throws a ValidationError', () => {
        assert(error);
        assertEqual('ValidationError', error.name);
    });

    it('includes enum validation error', () => {
        assertEqual(1, error.length);
        assertMatches('Domains contains an invalid value:', error.errors[0].message);
        assertEqual('domains', error.errors[0].source);
    });
});


describe('NewTicketForm#setFormData() when domains is a single value instead of array', ({ before, it }) => {
    let form;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        form.setFormData({
            title: 'Valid Title',
            status: 'status1',
            domains: 'domain1',
        });
    });

    it('converts single value to array', () => {
        const field = form.getField('domains');
        assert(Array.isArray(field.value));
        assertEqual(1, field.value.length);
        assertEqual('domain1', field.value[0]);
    });
});


describe('NewTicketForm#setFormData() when tags field has multiple space-separated values', ({ before, it }) => {
    let form;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        form.setFormData({
            title: 'Valid Title',
            status: 'status1',
            tags: 'bug feature urgent',
        });
    });

    it('splits tags into array', () => {
        const field = form.getField('tags');
        assert(Array.isArray(field.value));
        assertEqual(3, field.value.length);
        assertEqual('bug', field.value[0]);
        assertEqual('feature', field.value[1]);
        assertEqual('urgent', field.value[2]);
    });
});


describe('NewTicketForm#setFormData() when tags field has extra spaces', ({ before, it }) => {
    let form;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        form.setFormData({
            title: 'Valid Title',
            status: 'status1',
            tags: '  bug   feature  ',
        });
    });

    it('filters out empty strings from split', () => {
        const field = form.getField('tags');
        assert(Array.isArray(field.value));
        assertEqual(2, field.value.length);
        assertEqual('bug', field.value[0]);
        assertEqual('feature', field.value[1]);
    });
});


describe('NewTicketForm#setFormData() when estimatedHours is provided as string', ({ before, it }) => {
    let form;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        form.setFormData({
            title: 'Valid Title',
            status: 'status1',
            estimatedHours: '25',
        });
    });

    it('converts string to number', () => {
        const field = form.getField('estimatedHours');
        assertEqual(25, field.value);
        assertEqual('number', typeof field.value);
    });
});


describe('NewTicketForm#setFormData() with multiple validation errors', ({ before, it }) => {
    let form;
    let error;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        try {
            form.setFormData({
                title: 'x',
                priority: 99,
                estimatedHours: 200,
            });
        } catch (e) {
            error = e;
        }
    });

    it('throws a ValidationError', () => {
        assert(error);
        assertEqual('ValidationError', error.name);
    });

    it('includes all validation errors', () => {
        // Should have: title too short, priority invalid, status required, estimatedHours too high
        assert(error.length >= 4);
    });

    it('includes title minLength error', () => {
        const titleError = error.errors.find((e) => e.source === 'title');
        assert(titleError);
        assertMatches('must be at least 2 characters', titleError.message);
    });

    it('includes priority enum error', () => {
        const priorityError = error.errors.find((e) => e.source === 'priority');
        assert(priorityError);
        assertMatches('must be one of:', priorityError.message);
    });

    it('includes status required error', () => {
        const statusError = error.errors.find((e) => e.source === 'status');
        assert(statusError);
        assertMatches('is required', statusError.message);
    });

    it('includes estimatedHours maximum error', () => {
        const hoursError = error.errors.find((e) => e.source === 'estimatedHours');
        assert(hoursError);
        assertMatches('must be at most 100', hoursError.message);
    });
});


describe('NewTicketForm#setFormData() when optional fields are omitted', ({ before, it }) => {
    let form;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        form.setFormData({
            title: 'Valid Title',
            status: 'status1',
        });
    });

    it('does not throw an error', () => {
        // Test passes if we reach this point without error
        assert(true);
    });

    it('does not set value for omitted description field', () => {
        const field = form.getField('description');
        assertEqual(false, 'value' in field);
    });

    it('does not set value for omitted priority field', () => {
        const field = form.getField('priority');
        assertEqual(false, 'value' in field);
    });

    it('does not set value for omitted estimatedHours field', () => {
        const field = form.getField('estimatedHours');
        assertEqual(false, 'value' in field);
    });
});


describe('NewTicketForm#setFormData() when priority value is string representation of number', ({ before, it }) => {
    let form;

    before(() => {
        const context = createMockContext();
        form = new NewTicketForm(context);

        form.setFormData({
            title: 'Valid Title',
            status: 'status1',
            priority: '2',
        });
    });

    it('accepts string number that matches enum', () => {
        const field = form.getField('priority');
        assertEqual('2', field.value);
    });
});
