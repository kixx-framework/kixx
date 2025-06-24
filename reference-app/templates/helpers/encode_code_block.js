const ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '`': '&#x60;',
    '=': '&#x3D;',
};

const BAD_CHARS = /[&<>"'`=]/g;

function escapeChar(char) {
    return ESCAPE_MAP[char];
}

export const name = 'encode_code_block';

export function helper() {
    // eslint-disable-next-line no-invalid-this
    const str = this.renderPrimary();
    return str.replace(BAD_CHARS, escapeChar);
}
