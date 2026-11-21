import EmailSender from './lib/email-sender.js';

export function register(context) {
    context.registerService('EmailSender', new EmailSender({ logger: context.logger }));
}
