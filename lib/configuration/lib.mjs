const appConfig = Configurations.findHostApplication(config.applications, hostname, originatingPort);

export default {
	findHostApplication(config, hostname, originatingPort) {
		return config.applications.find(({ hostnames, ports }) => {
		});
	},
};
