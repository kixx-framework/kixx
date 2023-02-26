export default {

	findHostApplication(config, requestHostname, requestPort) {
		return config.applications.find(({ ports, hostnames }) => {
			for (let y = 0; y < hostnames.length; y = y + 1) {
				const { hostname } = hostnames[y];

				if (hostname && hostname === requestHostname) {
					return true;
				}
			}

			for (let n = 0; n < ports.length; n = n + 1) {
				if (requestPort === ports[n]) {
					return true;
				}
			}

			return false;
		});
	},

	getPreferredHost(appConfig) {
		if (appConfig.hostnames && appConfig.hostnames.length > 0) {
			return appConfig.hostnames[0].hostname;
		}

		return null;
	},

	getPreferredPort(appConfig) {
		if (appConfig.ports && appConfig.ports.length > 0) {
			return appConfig.ports[0];
		}

		return null;
	},
};
