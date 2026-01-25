export default function plusone_helper(context, options, val) {
    if (typeof val === 'number') {
        return String(val + 1);
    }
    // Handle string numbers
    const num = Number(val);
    if (!Number.isNaN(num)) {
        return String(num + 1);
    }
    // Return empty string for non-numeric values (consistent with other helpers)
    return '';
}
