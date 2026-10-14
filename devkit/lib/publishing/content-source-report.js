import UsageError from '../usage-error.js';

/**
 * Rejects scanner results that cannot be published, reporting every problem.
 * @param {Object} result - Content source scanner result
 * @param {Object[]} result.problems - Validation problems in reporting order
 * @param {string[]} result.unmatchedFiles - Project-relative unmatched files
 * @throws {UsageError} When one or more source problems prevent publishing
 */
export function assertPublishableContentSources(result) {
    const { problems, unmatchedFiles } = result;

    if (problems.length === 0) {
        return;
    }

    const sections = [
        'Content source validation failed:',
        problems.map(formatProblem).join('\n'),
        formatUnmatchedFiles(unmatchedFiles),
        'Nothing was published.',
    ].filter(Boolean);

    throw new UsageError(sections.join('\n\n'));
}

/**
 * Formats project-relative files that no publishing convention matched.
 * @param {string[]} unmatchedFiles - Project-relative source paths
 * @returns {string} Report section, or an empty string when every file matched
 */
export function formatUnmatchedFiles(unmatchedFiles) {
    if (unmatchedFiles.length === 0) {
        return '';
    }

    return [
        'Files not matched by a publishing convention:',
        ...unmatchedFiles.map((filepath) => `- ${ filepath }`),
    ].join('\n');
}

function formatProblem(problem) {
    return `- ${ problem.filepath }: ${ problem.message }`;
}
