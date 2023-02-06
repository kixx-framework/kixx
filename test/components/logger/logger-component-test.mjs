import { assert } from 'kixx-assert';
import { Logger } from 'kixx-logger';
import LoggerComponent from '../../../components/logger/component';

export default function runTest(test) {
	test.it('provides the root logger instance', () => {
		const c = new LoggerComponent();
		const logger = c.getRootLogger();
		console.log(logger);
		assert.isOk(logger instanceof Logger);
	});
}
