import {
    assert,
    assertNonEmptyString,
    isNonEmptyString,
} from '../../../kixx/assertions/mod.js';

/**
 * Renders published email bundles and sends them through the configured sender.
 */
export default class Mailer {

    #hyperviewService = null;
    #emailSender = null;

    /**
     * Wires registered services after plugin registration has completed.
     * @param {Object} options
     * @param {import('../../../kixx/hyperview/hyperview-service.js').default} options.hyperviewService
     * @param {import('../../../kixx/email-sender/email-sender-interface.js').EmailSenderInterface} options.emailSender
     */
    initialize(options) {
        const { hyperviewService, emailSender } = options ?? {};
        assert(hyperviewService, 'Mailer#initialize() requires a HyperviewService');
        assert(emailSender, 'Mailer#initialize() requires an EmailSender');
        this.#hyperviewService = hyperviewService;
        this.#emailSender = emailSender;
    }

    /**
     * Renders one published email bundle and awaits one sender attempt.
     * @param {import('../../../kixx/context/request-context.js').default} context - Request context for rendering and platform sending
     * @param {string} pathname - Canonical published email pathname
     * @param {Object} options - Recipient and template data
     * @param {string} options.to - One recipient address
     * @param {Object} [options.data={}] - Plain object merged into the email context
     * @returns {Promise<import('../../../kixx/email-sender/email-sender-interface.js').EmailSendResult>} Sender result
     * @throws {AssertionError} When the recipient or rendered content is invalid
     */
    async send(context, pathname, options) {
        assert(this.#hyperviewService, 'Mailer must be initialized before sending');
        assert(this.#emailSender, 'Mailer must be initialized before sending');
        const { to, data = {} } = options ?? {};
        assertNonEmptyString(to, 'Mailer.send() requires a non-empty "to" address');
        const email = await this.#hyperviewService.renderEmail(context, pathname, data);
        assert(
            isNonEmptyString(email.subject) && email.subject.trim().length > 0
                && ((isNonEmptyString(email.html) && email.html.trim().length > 0)
                    || (isNonEmptyString(email.text) && email.text.trim().length > 0)),
            'Mailer.send() requires a non-empty subject and at least one non-empty body',
        );

        return await this.#emailSender.send(context, { to, ...email });
    }
}
