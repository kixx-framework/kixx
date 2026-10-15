import Mailer from './lib/mailer.js';

export function register(context) {
    context.registerService('Mailer', new Mailer());
}

export function initialize(context) {
    const mailer = context.getService('Mailer');
    mailer.initialize({
        hyperviewService: context.getService('HyperviewService'),
        emailSender: context.getService('EmailSender'),
    });
}
