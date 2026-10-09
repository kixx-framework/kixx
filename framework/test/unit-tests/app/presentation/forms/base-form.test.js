import { describe } from 'kixx-test';
import {
    assert,
    assertEqual,
    assertFalsy,
    assertUndefined,
} from 'kixx-assert';
import BaseForm from '../../../../../src/app/presentation/forms/base-form.js';
import { ValidationError } from '../../../../../src/kixx/errors/mod.js';


describe('BaseForm', ({ describe }) => {

    class TestForm extends BaseForm {

        static target = 'test/create';

        static method = 'POST';

        static schema = {
            type: 'object',
            properties: {
                email_address: { type: 'string', fieldType: 'text', label: 'Email' },
                password: { type: 'string', fieldType: 'text', writeOnly: true },
            },
        };

        constructor(attributes) {
            super();

            const { email_address, password } = attributes ?? {};
            this.email_address = email_address;
            this.password = password;
        }
    }

    // Records what getFormContext() asked the routing layer for, so the reverse
    // routing contract can be asserted rather than inferred from the pathname.
    function makeContext(options) {
        const { targetIsRegistered = true } = options ?? {};
        const calls = { targetName: null, compileParams: null };

        return {
            calls,

            getHttpTarget(name) {
                calls.targetName = name;

                if (!targetIsRegistered) {
                    const error = new Error(`HttpTarget is not registered: ${ name }`);
                    error.name = 'AssertionError';
                    throw error;
                }

                return {
                    compilePathname(params) {
                        calls.compileParams = params;
                        return { pathname: '/test/create' };
                    },
                };
            },
        };
    }

    function catchError(fn) {
        try {
            fn();
        } catch (error) {
            return error;
        }
        return null;
    }

    describe('getFormContext() without dynamic metadata', ({ it }) => {

        it('projects schema metadata, values, and the compiled action URL', () => {
            const form = new TestForm({ email_address: 'me@example.com', password: 'secret' });
            const formContext = form.getFormContext(makeContext());

            assertEqual('TestForm', formContext.name);
            assertEqual('POST', formContext.method);
            assertEqual('/test/create', formContext.url);
            assertEqual(null, formContext.errorCode);
            assertEqual('Email', formContext.fields.email_address.label);
            assertEqual('text', formContext.fields.email_address.fieldType);
            assertEqual('email_address', formContext.fields.email_address.name);
            assertEqual('me@example.com', formContext.fields.email_address.value);
        });

        it('resolves the action target by the static target name', () => {
            const context = makeContext();
            new TestForm({}).getFormContext(context);

            assertEqual('test/create', context.calls.targetName);
        });

        it('compiles the action pathname from the form instance so route params hydrate', () => {
            const context = makeContext();
            const form = new TestForm({ email_address: 'me@example.com' });

            form.getFormContext(context);

            assertEqual(form, context.calls.compileParams);
        });

        it('propagates the lookup failure when the target is not registered', () => {
            const form = new TestForm({});
            const error = catchError(() => form.getFormContext(makeContext({ targetIsRegistered: false })));

            assertEqual('AssertionError', error.name);
        });

        it('omits the value of a writeOnly field entirely', () => {
            const form = new TestForm({ email_address: 'me@example.com', password: 'secret' });
            const formContext = form.getFormContext(makeContext());

            assert(Object.hasOwn(formContext.fields, 'password'));
            assertFalsy(Object.hasOwn(formContext.fields.password, 'value'));
        });

        it('renders an empty fields map for a schema which declares no properties', () => {
            class EmptyForm extends BaseForm {
                static target = 'test/create';
                static method = 'POST';
                static schema = { type: 'object', properties: {} };
            }

            const formContext = new EmptyForm().getFormContext(makeContext());

            assertEqual(0, Object.keys(formContext.fields).length);
            assertEqual('/test/create', formContext.url);
        });

        it('does not mutate the static schema', () => {
            const form = new TestForm({ email_address: 'me@example.com' });
            const formContext = form.getFormContext(makeContext());

            formContext.fields.email_address.label = 'Mutated';

            assertFalsy(Object.hasOwn(TestForm.schema.properties.email_address, 'name'));
            assertFalsy(Object.hasOwn(TestForm.schema.properties.email_address, 'value'));
            assertEqual('Email', TestForm.schema.properties.email_address.label);
        });
    });

    describe('getFormContext() error projection', ({ it }) => {

        it('projects a ValidationError onto the reporting fields', () => {
            const error = new ValidationError('Invalid');
            error.push('Email is required', 'email_address');

            const form = new TestForm({});
            const formContext = form.getFormContext(makeContext(), error);

            assertEqual('field_error', formContext.errorCode);
            assertEqual('Email is required', formContext.fields.email_address.error);
            assertFalsy(Object.hasOwn(formContext.fields.password, 'error'));
        });

        it('reports every field error from one ValidationError', () => {
            const error = new ValidationError('Invalid');
            error.push('Email is required', 'email_address');
            error.push('Password is required', 'password');

            const formContext = new TestForm({}).getFormContext(makeContext(), error);

            assertEqual('Email is required', formContext.fields.email_address.error);
            assertEqual('Password is required', formContext.fields.password.error);
        });

        it('ignores a field error whose source names no declared field', () => {
            const error = new ValidationError('Invalid');
            error.push('Nothing declares this', 'nope');

            const formContext = new TestForm({}).getFormContext(makeContext(), error);

            assertEqual('field_error', formContext.errorCode);
            assertFalsy(Object.hasOwn(formContext.fields.email_address, 'error'));
        });

        it('reports a domain error code string as the form error code', () => {
            const formContext = new TestForm({}).getFormContext(makeContext(), 'invalid_credentials');

            assertEqual('invalid_credentials', formContext.errorCode);
        });

        it('reports no error code when no error is passed', () => {
            const formContext = new TestForm({}).getFormContext(makeContext());

            assertEqual(null, formContext.errorCode);
        });

        it('reports no error code for an error which is neither a ValidationError nor a code string', () => {
            const formContext = new TestForm({}).getFormContext(makeContext(), new Error('Boom'));

            assertEqual(null, formContext.errorCode);
        });
    });

    describe('getFormContext() with dynamic metadata', ({ it }) => {

        it('merges dynamic metadata over the static schema metadata', () => {
            class DynamicForm extends TestForm {
                getDynamicFieldMetadata() {
                    return {
                        email_address: {
                            label: 'Work email',
                            options: [ { value: 'a', label: 'A' } ],
                        },
                    };
                }
            }

            const form = new DynamicForm({ email_address: 'me@example.com' });
            const formContext = form.getFormContext(makeContext());

            assertEqual('Work email', formContext.fields.email_address.label);
            assertEqual('text', formContext.fields.email_address.fieldType);
            assertEqual('a', formContext.fields.email_address.options[0].value);
        });

        it('receives the request context', () => {
            let received = null;

            class DynamicForm extends TestForm {
                getDynamicFieldMetadata(context) {
                    received = context;
                    return null;
                }
            }

            const context = makeContext();
            new DynamicForm({}).getFormContext(context);

            assertEqual(context, received);
        });

        it('treats an undefined return value as no dynamic metadata', () => {
            class DynamicForm extends TestForm {
                getDynamicFieldMetadata() {
                    return undefined;
                }
            }

            const formContext = new DynamicForm({ email_address: 'me@example.com' }).getFormContext(makeContext());

            assertEqual('Email', formContext.fields.email_address.label);
        });

        it('cannot override the field name, value, or error', () => {
            class DynamicForm extends TestForm {
                getDynamicFieldMetadata() {
                    return {
                        email_address: { name: 'spoofed', value: 'spoofed', error: 'spoofed' },
                        password: { value: 'secret', error: 'spoofed' },
                    };
                }
            }

            const error = new ValidationError('Invalid');
            error.push('Email is required', 'email_address');

            const form = new DynamicForm({ email_address: 'me@example.com', password: 'secret' });
            const formContext = form.getFormContext(makeContext(), error);

            assertEqual('email_address', formContext.fields.email_address.name);
            assertEqual('me@example.com', formContext.fields.email_address.value);
            assertEqual('Email is required', formContext.fields.email_address.error);
            assertFalsy(Object.hasOwn(formContext.fields.password, 'value'));
            assertFalsy(Object.hasOwn(formContext.fields.password, 'error'));
        });

        it('throws an AssertionError when metadata names an undeclared field', () => {
            class DynamicForm extends TestForm {
                getDynamicFieldMetadata() {
                    return { email_addresses: { label: 'Typo' } };
                }
            }

            const form = new DynamicForm({});
            const error = catchError(() => form.getFormContext(makeContext()));

            assertEqual('AssertionError', error.name);
            assert(error.message.includes('email_addresses'));
        });
    });

    describe('fromFormData()', ({ it }) => {

        it('hydrates the subclass, last value winning on duplicates', () => {
            const formData = new FormData();
            formData.append('email_address', 'first@example.com');
            formData.append('email_address', 'second@example.com');
            formData.append('password', 'secret');

            const form = TestForm.fromFormData(formData);

            assert(form instanceof TestForm);
            assertEqual('second@example.com', form.email_address);
            assertEqual('secret', form.password);
        });

        it('constructs the subclass it is called on', () => {
            class ChildForm extends TestForm {}

            const form = ChildForm.fromFormData(new FormData());

            assert(form instanceof ChildForm);
        });

        it('leaves an unsubmitted field undefined', () => {
            const formData = new FormData();
            formData.append('email_address', 'me@example.com');

            const form = TestForm.fromFormData(formData);

            assertUndefined(form.password);
        });
    });
});
