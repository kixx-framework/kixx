import { deepFreeze } from 'kixx-lib-es6';
import KixxAssert from 'kixx-assert';

const { isNonEmptyString } = KixxAssert.helpers;

export default class HostnameConfig {
	hostname = null;
	preferEncrypted = false;
	certificate = null;

	constructor(spec) {
		this.hostname = spec.hostname || null;
		this.preferEncrypted = Boolean(spec.preferEncrypted);
		this.certificate = spec.certificate || null;

		deepFreeze(this);
	}

	static fromConfigFile(preferEncrypted, config) {
		// TODO: Data validation for server config files

		const { hostname, certificate } = config;

		return new HostnameConfig({
			hostname,
			preferEncrypted: Boolean(preferEncrypted && isNonEmptyString(certificate)),
			certificate,
		});
	}
}
