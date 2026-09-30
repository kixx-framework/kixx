import { assert, assertNonEmptyString } from '../../../kixx/assertions/mod.js';

const DEFAULT_BINDING_NAME = 'SEND_EMAIL';

/**
 * Cloudflare Email Service adapter using the current request's binding.
 * @implements {import('../../../kixx/email-sender/email-sender-interface.js').EmailSenderInterface}
 */
export default class EmailSender {

    /**
     * Sends one structured message through the request-scoped Cloudflare binding.
     * @param {import('../../../kixx/context/request-context.js').default} context - Context exposing config and current Worker environment
     * @param {import('../../../kixx/email-sender/email-sender-interface.js').EmailSenderMessage} message - Rendered message
     * @returns {Promise<import('../../../kixx/email-sender/email-sender-interface.js').EmailSendResult>} Provider result
     */
    async send(context, message) {
        const { config, env } = context;
        const senderConfig = config?.env?.SEND_EMAIL ?? {};
        const bindingName = senderConfig.bindingName || DEFAULT_BINDING_NAME;
        const binding = env[bindingName];
        assert(binding, `Cloudflare EmailSender binding "${ bindingName }" is not bound on context.env`);
        assertNonEmptyString(senderConfig.from, 'Cloudflare EmailSender requires context.config.env.SEND_EMAIL.from');

        const { to, subject, html, text } = message;
        return await binding.send({
            to,
            from: senderConfig.from,
            subject,
            ...(html === null ? {} : { html }),
            ...(text === null ? {} : { text }),
        });
    }
}
