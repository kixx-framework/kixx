import { assert, isNumberNotNaN } from '../../../kixx/assertions/mod.js';
import { PayloadTooLargeError } from '../../../kixx/errors/mod.js';


/**
 * Buffers a request body into bytes while enforcing a hard size cap.
 *
 * The body must be buffered (not streamed through) because callers need the full
 * content in hand: to enforce the size limit, to compute a SHA-256 ETag, and
 * because Cloudflare KV writes require a known content length. A bodyless
 * request resolves to a zero-length array; deciding whether empty is an error is
 * left to the caller.
 *
 * @param {import('../../../kixx/http-router/server-request-interface.js').ServerRequestInterface} request - Incoming request whose one-shot body stream is consumed.
 * @param {number} maxBytes - Maximum number of bytes to accept.
 * @returns {Promise<Uint8Array>} The buffered request body bytes.
 * @throws {PayloadTooLargeError} When the body exceeds `maxBytes`.
 */
export async function bufferRequestBodyWithLimit(request, maxBytes) {
    assert(isNumberNotNaN(maxBytes) && maxBytes > 0, 'bufferRequestBodyWithLimit: maxBytes must be a positive number');

    // Fast path: a truthful Content-Length lets us reject an oversized upload
    // before reading any of the body. A missing, non-numeric, or understated
    // value falls through to the streaming guard below, which is authoritative.
    const declaredLength = Number.parseInt(request.headers.get('content-length'), 10);
    if (isNumberNotNaN(declaredLength) && declaredLength > maxBytes) {
        throw new PayloadTooLargeError(
            `Request body exceeds the maximum of ${ maxBytes } bytes.`,
        );
    }

    // A bodyless request (e.g. an empty PUT) has a null body stream.
    if (!request.body) {
        return new Uint8Array(0);
    }

    const reader = request.body.getReader();
    const chunks = [];
    let totalBytes = 0;

    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }

            totalBytes += value.byteLength;

            // Enforce the cap against the accumulated size, defending against a
            // client whose Content-Length lied or was absent. Stop pulling the
            // body the moment the limit is crossed.
            if (totalBytes > maxBytes) {
                await reader.cancel();
                throw new PayloadTooLargeError(
                    `Request body exceeds the maximum of ${ maxBytes } bytes.`,
                );
            }

            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    // Concatenate the collected chunks into a single contiguous byte array.
    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }

    return body;
}
