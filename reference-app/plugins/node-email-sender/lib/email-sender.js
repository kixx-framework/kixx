/**
 * Node adapter that records rendered messages for local development.
 * @implements {import('../../../kixx/email-sender/email-sender-interface.js').EmailSenderInterface}
 */
export default class EmailSender {

    #logger;

    /**
     * @param {Object} options
     * @param {import('../../../kixx/logger/logger.js').default} options.logger
     */
    constructor(options) {
        this.#logger = options.logger.createChild('EmailSender');
    }

    /**
     * Logs one rendered message without delivering it or writing it to storage.
     * @param {import('../../../kixx/context/request-context.js').default} _context - Unused Node-compatible context
     * @param {import('../../../kixx/email-sender/email-sender-interface.js').EmailSenderMessage} message - Rendered message
     * @returns {Promise<import('../../../kixx/email-sender/email-sender-interface.js').EmailSendResult>} Generated local message ID
     */
    async send(_context, message) {
        const messageId = crypto.randomUUID();
        const { to, subject, html, text } = message;
        this.#logger.info('logged email message', {
            messageId,
            to,
            subject,
            ...(html === null ? {} : { html }),
            ...(text === null ? {} : { text }),
        });
        return { messageId };
    }
}
