import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import EmailSender from '../../../../src/plugins/node-email-sender/lib/email-sender.js';

describe('Node EmailSender', ({ it }) => {
    it('logs one message with a generated ID and does not write a file', async () => {
        const logs = [];
        const logger = {
            createChild() {
                return {
                    info(...args) {
                        logs.push(args);
                    },
                };
            },
        };
        const sender = new EmailSender({ logger });
        const result = await sender.send({}, {
            to: 'to@example.com', subject: 'Subject', html: '<p>Body</p>', text: null,
        });

        assertEqual(1, logs.length);
        assertEqual('logged email message', logs[0][0]);
        assertEqual(result.messageId, logs[0][1].messageId);
        assertEqual('to@example.com', logs[0][1].to);
        assertEqual('<p>Body</p>', logs[0][1].html);
        assertEqual(false, Object.hasOwn(logs[0][1], 'text'));
        assertEqual('string', typeof result.messageId);
    });
});
