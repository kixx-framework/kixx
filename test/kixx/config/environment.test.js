import { describe } from 'kixx-test';
import { assertEqual } from 'kixx-assert';

import {
    DEVELOPMENT_ENVIRONMENT,
    isDevelopmentEnvironment,
} from '../../../kixx/config/environment.js';


describe('isDevelopmentEnvironment', ({ it }) => {
    it('names the development environment', () => {
        assertEqual('development', DEVELOPMENT_ENVIRONMENT);
    });

    it('is true only for the development environment', () => {
        assertEqual(true, isDevelopmentEnvironment({ environment: 'development' }));
        assertEqual(false, isDevelopmentEnvironment({ environment: 'production' }));
        assertEqual(false, isDevelopmentEnvironment({ environment: 'Development' }));
        assertEqual(false, isDevelopmentEnvironment({}));
    });

    it('is false for a missing config', () => {
        assertEqual(false, isDevelopmentEnvironment(undefined));
        assertEqual(false, isDevelopmentEnvironment(null));
    });
});
