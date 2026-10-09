import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import EmailSender from '../../../../src/plugins/cloudflare-email-sender/lib/email-sender.js';

async function catchAsyncError(fn) {
    try {
        await fn();
    } catch (error) {
        return error;
    }
    return null;
}

describe('Cloudflare EmailSender', ({ it }) => {
    it('uses the current request binding and configured sender, omitting null bodies', async () => {
        const calls = [];
        const binding = {
            async send(message) {
                calls.push(message);
                return { messageId: 'provider-id' };
            },
        };
        const sender = new EmailSender();
        const result = await sender.send({
            config: { env: { SEND_EMAIL: { bindingName: 'CUSTOM_EMAIL', from: 'sender@example.com' } } },
            env: {
                CUSTOM_EMAIL: binding,
                SEND_EMAIL: {
                    send() {
                        throw new Error('wrong binding');
                    },
                },
            },
        }, { to: 'to@example.com', subject: 'Subject', html: '<p>Body</p>', text: null });

        assertEqual('provider-id', result.messageId);
        assertEqual(JSON.stringify({
            to: 'to@example.com', from: 'sender@example.com', subject: 'Subject', html: '<p>Body</p>',
        }), JSON.stringify(calls[0]));
    });

    it('uses the default binding name and forwards the provider result', async () => {
        const resultValue = { messageId: 'default-id' };
        const sender = new EmailSender();
        const result = await sender.send({
            config: { env: { SEND_EMAIL: { from: 'sender@example.com' } } },
            env: {
                SEND_EMAIL: {
                    async send() {
                        return resultValue;
                    },
                },
            },
        }, { to: 'to@example.com', subject: 'Subject', html: null, text: 'Body' });
        assertEqual(resultValue, result);
    });

    it('asserts when the configured binding is missing', async () => {
        const sender = new EmailSender();
        const error = await catchAsyncError(() => sender.send({
            config: { env: { SEND_EMAIL: { from: 'sender@example.com' } } },
            env: {},
        }, { to: 'to@example.com', subject: 'Subject', html: null, text: 'Body' }));
        assert(error);
        assertEqual('AssertionError', error.name);
    });
});
