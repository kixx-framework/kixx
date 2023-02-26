import readFileConfiguration from './read-file-configuration.mjs';

export default function readConfiguration(params) {
	const { configDirectory } = params;

	return readFileConfiguration(configDirectory);
}
