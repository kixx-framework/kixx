const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Encodes bytes as unpadded base64url text.
 * @param {Uint8Array} bytes - Bytes to encode.
 * @returns {string} Base64url-encoded text with no `+`, `/`, or `=` characters.
 */
export function bytesToBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * Decodes base64url text back to bytes, rejecting any non-canonical encoding.
 * @param {string} value - Base64url-encoded text.
 * @returns {Uint8Array} Decoded bytes.
 * @throws {Error} When value contains characters outside the base64url alphabet, or decodes to a value whose canonical re-encoding does not match the input.
 */
export function base64UrlToBytes(value) {
    if (!BASE64URL_PATTERN.test(value)) {
        throw new Error('Invalid base64url value');
    }

    const paddedValue = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(
        Math.ceil(value.length / 4) * 4,
        '=',
    );
    const binary = atob(paddedValue);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    // Reject permissive atob() decodes so each value has one canonical form.
    if (bytesToBase64Url(bytes) !== value) {
        throw new Error('Invalid base64url value');
    }

    return bytes;
}
