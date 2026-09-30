/**
 * @typedef {import('../context/request-context.js').default} RequestContext
 * @typedef {Object} EmailSenderMessage
 * @property {string} to - One recipient address
 * @property {string} subject - Rendered email subject
 * @property {string|null} html - Rendered HTML body, or null when unavailable
 * @property {string|null} text - Rendered plain-text body, or null when unavailable
 * @typedef {Object} EmailSendResult
 * @property {string} messageId - Identifier returned by the sender
 */

/**
 * Sends one already-rendered email. The configured sender address belongs to
 * the adapter, and the returned ID means accepted by its backing sender (or
 * logged by the Node adapter), not confirmed delivery to the recipient.
 * @typedef {Object} EmailSenderInterface
 * @property {(context: RequestContext, message: EmailSenderMessage) => Promise<EmailSendResult>} send
 */

export {};
