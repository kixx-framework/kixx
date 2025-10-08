import { describe } from 'kixx-test';
import { assert, assertEqual } from 'kixx-assert';
import urnPatternToRegexp from '../../lib/lib/urn-pattern-to-regexp.js';

describe('urnPatternToRegexp(): with pattern without wildcards', ({ before, it }) => {
    let pattern;
    let regex;

    before(() => {
        pattern = 'kixx:partition:service:region:account-id:resource-id';
        regex = urnPatternToRegexp(pattern);
    });

    it('returns a RegExp', () => {
        assert(regex instanceof RegExp);
    });

    it('matches the exact URN string', () => {
        const urn = 'kixx:partition:service:region:account-id:resource-id';
        assertEqual(true, regex.test(urn), 'exact match should pass');
    });

    it('does not match a URN with different values', () => {
        const urn = 'kixx:partition:service:region:different-account:resource-id';
        assertEqual(false, regex.test(urn), 'different value should not match');
    });

    it('does not match a URN with extra segments', () => {
        const urn = 'kixx:partition:service:region:account-id:resource-id:extra';
        assertEqual(false, regex.test(urn), 'extra segments should not match');
    });

    it('does not match a URN with fewer segments', () => {
        const urn = 'kixx:partition:service:region:account-id';
        assertEqual(false, regex.test(urn), 'fewer segments should not match');
    });
});

describe('urnPatternToRegexp(): with pattern containing single wildcard at end', ({ before, it }) => {
    let pattern;
    let regex;

    before(() => {
        pattern = 'arn:aws:service:region:account-id:*';
        regex = urnPatternToRegexp(pattern);
    });

    it('matches URN with any value in wildcard position', () => {
        assertEqual(true, regex.test('arn:aws:service:region:account-id:resource-123'));
        assertEqual(true, regex.test('arn:aws:service:region:account-id:other-resource'));
        assertEqual(true, regex.test('arn:aws:service:region:account-id:xyz'));
    });

    it('matches URN with empty value in wildcard position', () => {
        const urn = 'arn:aws:service:region:account-id:';
        assertEqual(true, regex.test(urn), 'empty wildcard segment should match');
    });

    it('does not match URN with different non-wildcard segments', () => {
        const urn = 'arn:gcp:service:region:account-id:resource-123';
        assertEqual(false, regex.test(urn), 'different non-wildcard segment should not match');
    });

    it('does not match URN with wildcard spanning multiple segments', () => {
        const urn = 'arn:aws:service:region:account-id:resource:extra';
        assertEqual(false, regex.test(urn), 'wildcard should not match multiple segments');
    });
});

describe('urnPatternToRegexp(): with pattern containing single wildcard in middle', ({ before, it }) => {
    let pattern;
    let regex;

    before(() => {
        pattern = 'arn:*:service:region:account-id:resource';
        regex = urnPatternToRegexp(pattern);
    });

    it('matches URN with any value in wildcard position', () => {
        assertEqual(true, regex.test('arn:aws:service:region:account-id:resource'));
        assertEqual(true, regex.test('arn:gcp:service:region:account-id:resource'));
        assertEqual(true, regex.test('arn:azure:service:region:account-id:resource'));
    });

    it('matches URN with empty value in wildcard position', () => {
        const urn = 'arn::service:region:account-id:resource';
        assertEqual(true, regex.test(urn), 'empty wildcard segment should match');
    });

    it('does not match URN with different non-wildcard segments', () => {
        const urn = 'arn:aws:different-service:region:account-id:resource';
        assertEqual(false, regex.test(urn), 'different non-wildcard segment should not match');
    });
});

describe('urnPatternToRegexp(): with pattern containing multiple wildcards', ({ before, it }) => {
    let pattern;
    let regex;

    before(() => {
        pattern = 'arn:*:service:*:account-id:*';
        regex = urnPatternToRegexp(pattern);
    });

    it('matches URN with any values in all wildcard positions', () => {
        assertEqual(true, regex.test('arn:aws:service:us-east-1:account-id:resource-123'));
        assertEqual(true, regex.test('arn:gcp:service:eu-west-1:account-id:other-resource'));
        assertEqual(true, regex.test('arn:azure:service:ap-south-1:account-id:xyz'));
    });

    it('matches URN with empty values in wildcard positions', () => {
        const urn = 'arn::service::account-id:';
        assertEqual(true, regex.test(urn), 'empty wildcard segments should match');
    });

    it('does not match URN with different non-wildcard segments', () => {
        const urn = 'arn:aws:different:region:account-id:resource';
        assertEqual(false, regex.test(urn), 'different non-wildcard segment should not match');
    });
});

describe('urnPatternToRegexp(): with pattern containing all wildcards', ({ before, it }) => {
    let pattern;
    let regex;

    before(() => {
        pattern = '*:*:*:*:*:*';
        regex = urnPatternToRegexp(pattern);
    });

    it('matches any URN with correct number of segments', () => {
        assertEqual(true, regex.test('arn:aws:service:region:account:resource'));
        assertEqual(true, regex.test('kixx:a:b:c:d:e'));
        assertEqual(true, regex.test('foo:bar:baz:qux:quux:corge'));
    });

    it('matches URN with all empty segments', () => {
        const urn = ':::::';
        assertEqual(true, regex.test(urn), 'all empty segments should match');
    });

    it('does not match URN with different number of segments', () => {
        assertEqual(false, regex.test('arn:aws:service:region:account'));
        assertEqual(false, regex.test('arn:aws:service:region:account:resource:extra'));
    });
});

describe('urnPatternToRegexp(): with pattern containing special regex characters', ({ before, it }) => {
    let pattern;
    let regex;

    before(() => {
        pattern = 'arn:aws:service.name:region-us-east:account+id:resource(1)';
        regex = urnPatternToRegexp(pattern);
    });

    it('matches URN with special characters treated as literals', () => {
        const urn = 'arn:aws:service.name:region-us-east:account+id:resource(1)';
        assertEqual(true, regex.test(urn), 'special characters should be escaped');
    });

    it('does not match URN where special characters are missing', () => {
        const urn = 'arn:aws:servicename:region-us-east:account+id:resource(1)';
        assertEqual(false, regex.test(urn), 'missing dot should not match');
    });

    it('does not match URN where special characters differ', () => {
        const urn = 'arn:aws:service.name:region-us-east:account+id:resource[1]';
        assertEqual(false, regex.test(urn), 'different special character should not match');
    });
});

describe('urnPatternToRegexp(): pattern ensures wildcards do not match colons', ({ before, it }) => {
    let pattern;
    let regex;

    before(() => {
        pattern = 'arn:*:service';
        regex = urnPatternToRegexp(pattern);
    });

    it('does not match URN where wildcard would need to span multiple segments', () => {
        const urn = 'arn:aws:ec2:service';
        assertEqual(false, regex.test(urn), 'wildcard should not match across segments');
    });

    it('matches URN where wildcard matches segment without colons', () => {
        const urn = 'arn:aws-ec2:service';
        assertEqual(true, regex.test(urn), 'wildcard can match hyphens and other non-colon chars');
    });
});
