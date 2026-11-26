/**
 * The publish gates: the rules of REQUIREMENTS.md §5.3 the server enforces
 * (CONT-4, CONT-5, CONT-6), as pure validators and one function that assigns
 * a Release through them. The Publishing API and Studio's in-process publish
 * share it. See ./README.md.
 * @module publish-gates
 */
export {
    BUILD_ASSIGNMENT_INTENTS,
    assignReleaseThroughGates,
    findBuildAssignmentProblems,
    findReleaseProvenanceProblems,
} from './publish-gates.js';
