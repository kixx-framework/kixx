
// This deep merge algorithm will clobber target properties with
// source Arrays, or concatenate them if they are both Arrays.
export default function deepMerge(finalTarget, ...objects) {

    function mergeInto(target, source) {
        for (const key of Object.keys(source)) {
            const src = source[key];
            const dest = target[key];

            if (Array.isArray(dest) && Array.isArray(src)) {
                // If both the source AND target are Arrays, then concatenate them.
                target[key] = dest.concat(src);
            } else if (Array.isArray(dest) || Array.isArray(src)) {
                // If either the source OR target are Arrays,
                // then the source will override the target.
                target[key] = source[key];
            } else if (dest && typeof dest === 'object' && src && typeof src === 'object') {
                mergeInto(dest, src);
            } else {
                target[key] = source[key];
            }
        }
    }

    for (const src of objects) {
        mergeInto(finalTarget, src);
    }

    return finalTarget;
}
