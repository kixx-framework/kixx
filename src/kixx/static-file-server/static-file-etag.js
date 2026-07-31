import { sha256Hex } from '../utils/crypto.js';


/**
 * Computes the quoted strong SHA-256 ETag used for static-file bytes.
 * @param {ArrayBuffer|ArrayBufferView|string} body - Bytes or text to hash.
 * @returns {Promise<string>} Quoted lowercase SHA-256 ETag.
 */
export async function computeStaticFileEtag(body) {
    return `"${ await sha256Hex(body) }"`;
}
