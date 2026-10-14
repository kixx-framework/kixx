/**
 * Creates a writable stand-in for the output stream a command writes its
 * result to.
 *
 * Commands accept an `output` stream so a test can read what was written
 * without replacing process.stdout.write(). A replacement is global: a test
 * which fails before restoring it leaves every later test, and the test
 * runner's own reporting, writing into the mock.
 *
 * @returns {{ write: function(string): boolean, chunks: string[] }} A stream
 *   accepting write() calls, and the array of strings written so far.
 */
export default function captureOutput() {
    const chunks = [];

    return {
        chunks,
        write(text) {
            chunks.push(text);
            return true;
        },
    };
}
