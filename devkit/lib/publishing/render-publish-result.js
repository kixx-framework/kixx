/**
 * Formats a publish result without exposing credentials.
 * @param {Object} args - Output details
 * @param {Object} args.result - `publishContent()` result plus `buildId` and `assignmentId`
 * @param {string} args.environment - Application environment
 * @param {string} args.origin - Publishing API origin
 * @param {boolean} [args.verbose] - List every resource and its disposition
 * @returns {string} Terminal output ending in a newline
 */
export function renderPublishResult(args) {
    const { result, environment, origin, verbose } = args ?? {};
    const { buildId, assignmentId } = result;
    const totalCount = result.matchedCount + result.uploadedCount;
    const uploadLabel = result.dryRun ? 'would upload' : 'uploaded';
    const lines = [
        `Environment: ${ environment }`,
        `Origin:      ${ origin }`,
        `BUILD_ID:    ${ buildId }`,
    ];

    // The assignment identity is the only value tying this output to an entry
    // in the build's activation history.
    if (assignmentId) {
        lines.push(`Assignment:  ${ assignmentId }`);
    }

    lines.push(
        '',
        `Resources: ${ totalCount } total; ${ result.matchedCount } matched; ` +
            `${ result.uploadedCount } ${ uploadLabel }`,
        '',
        result.dryRun ? 'Resources that would upload:' : 'Uploaded resources:',
    );
    appendResources(lines, result.uploadedResources);
    lines.push('', 'Files not matched by a publishing convention:');
    appendValues(lines, result.unmatchedFiles);

    if (verbose) {
        lines.push('', 'All resources:');
        appendAllResources(lines, result.resources);
    }

    lines.push('');
    if (result.dryRun) {
        lines.push('Dry run: unvalidated preview; no objects, Release, or build pointer were written.');
    } else {
        lines.push(`Release: ${ result.releaseId }`);
        lines.push(`Objects: ${ result.objectCount }; ${ result.totalBytes } bytes`);
    }
    lines.push('');
    return lines.join('\n');
}

function appendResources(lines, resources) {
    if (resources.length === 0) {
        lines.push('  (none)');
        return;
    }
    for (const resource of resources) {
        lines.push(`  ${ resource.type } ${ resource.pathname || '/' }`);
    }
}

function appendValues(lines, values) {
    if (values.length === 0) {
        lines.push('  (none)');
        return;
    }
    for (const value of values) {
        lines.push(`  ${ value }`);
    }
}

function appendAllResources(lines, resources) {
    if (resources.length === 0) {
        lines.push('  (none)');
        return;
    }
    for (const resource of resources) {
        lines.push(
            `  ${ resource.disposition.padEnd(8) } ${ resource.type } ` +
            `${ resource.pathname || '/' } ${ resource.hash } ${ resource.size } bytes`,
        );
    }
}
