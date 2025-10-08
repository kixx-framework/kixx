export default function urnPatternToRegexp(pattern) {
    // Split the pattern by colons to get segments
    const segments = pattern.split(':');

    // Process each segment
    const regexSegments = segments.map((segment) => {
        if (segment === '*') {
            // Match any characters except colon (including empty string)
            return '[^:]*';
        }
        // Escape special regex characters
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    });

    // Join segments with literal colons and anchor at start and end
    const regexPattern = '^' + regexSegments.join(':') + '$';

    return new RegExp(regexPattern);
}
