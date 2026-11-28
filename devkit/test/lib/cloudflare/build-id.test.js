import { describe } from 'kixx-test';
import { assertEqual } from '../../../lib/vendor/kixx-assert/mod.js';
import { formatBuildId } from '../../../lib/cloudflare/build-id.js';


describe('build-id', ({ it }) => {
    it('formats a known Date as YYYY-MM-DDTHH-MM-SSZ in UTC', () => {
        const date = new Date('2026-08-29T16:49:32.000Z');

        assertEqual('2026-08-29T16-49-32Z', formatBuildId(date));
    });

    it('zero-pads single-digit components', () => {
        const date = new Date('2026-01-02T03:04:05.000Z');

        assertEqual('2026-01-02T03-04-05Z', formatBuildId(date));
    });

    it('is unaffected by the host time zone, since toISOString() is always UTC', () => {
        const date = new Date(Date.UTC(2026, 5, 15, 12, 0, 0));

        assertEqual('2026-06-15T12-00-00Z', formatBuildId(date));
    });

    it('appends an injected collision-resistant component', () => {
        const date = new Date('2026-08-29T16:49:32.000Z');

        assertEqual('2026-08-29T16-49-32Z-attempt-1', formatBuildId(date, 'attempt-1'));
    });
});
