import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import Mailer from '../../../../src/plugins/mailer/lib/mailer.js';

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

function makeMailer(email, sender = {}) {
    const calls = { renders: [], sends: [] };
    const hyperviewService = {
        async renderEmail(...args) {
            calls.renders.push(args);
            if (email instanceof Error) {
                throw email;
            }
            return email;
        },
    };
    const emailSender = {
        async send(...args) {
            calls.sends.push(args);
            if (sender.error) {
                throw sender.error;
            }
            return sender.result ?? { messageId: 'local-id' };
        },
    };
    const mailer = new Mailer();
    mailer.initialize({ hyperviewService, emailSender });
    return { mailer, calls };
}

describe('Mailer', ({ it }) => {
    it('passes rendered HTML-only, text-only, and two-body messages to the sender', async () => {
        for (const email of [
            { subject: 'Subject', html: '<p>Only HTML</p>', text: null },
            { subject: 'Subject', html: null, text: 'Only text' },
            { subject: 'Subject', html: '<p>Both</p>', text: 'Both' },
        ]) {
            const { mailer, calls } = makeMailer(email);
            const result = await mailer.send({}, '/example', { to: 'a@example.com', data: { name: 'A' } });

            assertEqual('local-id', result.messageId);
            assertEqual(1, calls.renders.length);
            assertEqual('/example', calls.renders[0][1]);
            assertEqual('{"name":"A"}', JSON.stringify(calls.renders[0][2]));
            assertEqual(JSON.stringify({ to: 'a@example.com', ...email }), JSON.stringify(calls.sends[0][1]));
        }
    });

    it('rejects an empty recipient or invalid rendered content before sending', async () => {
        const cases = [
            { email: { subject: 'Subject', html: 'Body', text: null }, to: '' },
            { email: { subject: '', html: 'Body', text: null }, to: 'a@example.com' },
            { email: { subject: 'Subject', html: null, text: null }, to: 'a@example.com' },
        ];

        for (const { email, to } of cases) {
            const { mailer, calls } = makeMailer(email);
            const error = await catchAsyncError(() => mailer.send({}, '/example', { to }));
            assert(error, 'expected validation to reject');
            assertEqual('AssertionError', error.name);
            assertEqual(0, calls.sends.length);
        }
    });

    it('propagates renderer and sender failures unchanged', async () => {
        const renderFailure = new Error('render failed');
        const renderMailer = makeMailer(renderFailure);
        const renderError = await catchAsyncError(() => renderMailer.mailer.send({}, '/example', { to: 'a@example.com' }));
        assertEqual(renderFailure, renderError);
        assertEqual(0, renderMailer.calls.sends.length);

        const sendFailure = new Error('send failed');
        const sendMailer = makeMailer({ subject: 'Subject', html: null, text: 'Body' }, { error: sendFailure });
        const sendError = await catchAsyncError(() => sendMailer.mailer.send({}, '/example', { to: 'a@example.com' }));
        assertEqual(sendFailure, sendError);
    });
});
