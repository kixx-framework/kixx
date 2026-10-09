import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';

import routes from '../../../src/routes/publishing-api-v1.js';


describe('Publishing API v1 routes', ({ it }) => {

    it('exposes only the object, Release, build, and discovery resources', () => {
        const patterns = routes.map((route) => route.pattern);

        assertEqual(10, patterns.length);
        assert(patterns.includes('/objects/status'));
        assert(patterns.includes('/objects/:objectId'));
        assert(patterns.includes('/releases{/}'));
        assert(patterns.includes('/builds/:buildId'));
        assertEqual(false, patterns.some((pattern) => pattern.startsWith('/index')));
        assertEqual(false, patterns.some((pattern) => pattern.startsWith('/resources')));
    });

    it('groups methods for one pathname so unsupported methods produce one Allow set', () => {
        const releases = routes.find((route) => route.pattern === '/releases{/}');
        const build = routes.find((route) => route.pattern === '/builds/:buildId');

        assertEqual('GET,POST', releases.targets.map((target) => target.methods[0]).join(','));
        assertEqual('GET,PUT', build.targets.map((target) => target.methods[0]).join(','));
    });
});
