import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import RunJobNowForm from '../../../../../app/presentation/forms/jobs/run-job-now-form.js';


function catchError(fn) {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
}

function assertPayloadError(payload, expectedMessage) {
    const form = new RunJobNowForm({ name: 'plain-job', payload });
    const error = catchError(() => form.validate());

    assert(error);
    assertEqual('ValidationError', error.name);
    assertEqual(1, error.errors.length);
    assertEqual('payload', error.errors[0].source);
    assertEqual(expectedMessage, error.errors[0].message);

    return error;
}


describe('RunJobNowForm', ({ it }) => {

    it('defaults the payload to {} and trims the name', () => {
        const form = new RunJobNowForm({ name: '  plain-job ' });
        assertEqual('plain-job', form.name);
        assertEqual('{}', form.payload);
    });

    it('parses an object payload', () => {
        const form = new RunJobNowForm({ name: 'plain-job', payload: '{"a":1}' });
        form.validate();
        assertEqual(1, form.payloadValue.a);
    });

    it('keeps the submitted payload text exactly', () => {
        const text = '  [1, 2]\n';
        const form = new RunJobNowForm({ name: 'plain-job', payload: text });
        form.validate();
        assertEqual(text, form.payload);
        assertEqual('1,2', form.payloadValue.join(','));
    });

    it('parses a null payload', () => {
        const form = new RunJobNowForm({ name: 'plain-job', payload: 'null' });
        form.validate();
        assertEqual(null, form.payloadValue);
    });

    it('rejects blank and whitespace-only payloads', () => {
        const message = 'Enter a JSON payload. Use {} for an empty payload.';
        assertPayloadError('', message);
        assertPayloadError('  \n\t', message);
    });

    it('rejects invalid JSON without the parser message', () => {
        let parserMessage;
        try {
            JSON.parse('{');
        } catch (error) {
            parserMessage = error.message;
        }

        const error = assertPayloadError('{', 'The payload must be valid JSON.');

        assertEqual(false, error.message.includes(parserMessage));
        assertEqual(false, error.errors[0].message.includes(parserMessage));
    });

    it('rejects a non-string payload', () => {
        assertPayloadError(new Blob([ 'x' ]), 'The payload must be text.');
    });

    it('does not validate the name', () => {
        const form = new RunJobNowForm({ payload: '{}' });
        form.validate();
        assertEqual(undefined, form.name);
    });

    it('renders the submitted text and field error', () => {
        const context = {
            getHttpTarget(name) {
                assertEqual('admin-panel/job-registry/run-now', name);
                return { compilePathname: () => ({ pathname: '/admin/jobs/registered' }) };
            },
        };
        const form = new RunJobNowForm({ name: 'plain-job', payload: '{' });
        const error = catchError(() => form.validate());

        const formContext = form.getFormContext(context, error);

        assertEqual('/admin/jobs/registered', formContext.url);
        assertEqual('POST', formContext.method);
        assertEqual('plain-job', formContext.fields.name.value);
        assertEqual('{', formContext.fields.payload.value);
        assertEqual('The payload must be valid JSON.', formContext.fields.payload.error);
        assertEqual('Payload (JSON)', formContext.fields.payload.label);
    });

    it('builds a form from FormData', () => {
        const formData = new FormData();
        formData.set('name', 'plain-job');
        formData.set('payload', '{"b":2}');

        const form = RunJobNowForm.fromFormData(formData);
        form.validate();

        assertEqual('plain-job', form.name);
        assertEqual(2, form.payloadValue.b);
    });
});
