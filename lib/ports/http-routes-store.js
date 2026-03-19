/**
 * HttpRoutesStore port — the abstraction for loading virtual host and route
 * specifications that HttpRouter uses to build its routing table.
 *
 * Implement this interface to support different route sources: in-memory
 * JavaScript arrays (MemoryHttpRoutesStore), database-backed routes,
 * file-system config files, etc.
 *
 * ## Invariants
 * - loadVirtualHosts() MUST resolve with an Array (never reject); return an
 *   empty Array when no virtual hosts are configured
 * - Each element of the resolved Array MUST conform to the VirtualHostSpec
 *   shape that HttpRouter.loadRoutes() expects
 * - Callers may call loadVirtualHosts() more than once (e.g. on hot-reload);
 *   implementations MUST be safe to call repeatedly
 *
 * @module ports/http-routes-store
 */

/**
 * @typedef {Object} HttpRoutesStore
 * @property {function(): Promise<Array<Object>>} loadVirtualHosts
 *   Loads virtual host specifications. Each element must conform to the
 *   VirtualHostSpec shape. MUST resolve with an Array (never reject).
 */
