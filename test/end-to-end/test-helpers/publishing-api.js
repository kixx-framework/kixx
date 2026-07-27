// Every Publishing API write is namespaced by the build id in the
// `kixx-build-id` request header. Generate a fresh one per test run so writes
// land in a throwaway namespace: the running site never reads it, and it can
// never collide with the current build, which putTemplate() rejects with a 409.
//
// Nothing removes these namespaces afterward — the Publishing API has no delete
// route — so the `e2e-` prefix marks them as test litter for whoever cleans up.
export const TEST_BUILD_ID = `e2e-${ crypto.randomUUID() }`;
