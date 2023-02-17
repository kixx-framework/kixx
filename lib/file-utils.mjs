import fsp from 'node:fs/promises';
import fs from 'node:fs';
import { OperationalError } from 'kixx-server-errors';
import toml from 'toml';

export function isDirectory(filepath) {
	const stat = fs.statSync(filepath, { throwIfNoEntry: false });
	return stat && stat.isDirectory();
}

// This function could be extended to support other config file formats.
export async function readConfigFile(filepath) {
	let utf8Text;
	try {
		utf8Text = await fsp.readFile(filepath, 'utf8');
	} catch (cause) {
		throw new OperationalError(
			`Error (${ cause.code }) reading configuration file ${ filepath }`,
			{
				cause,
				info: { filepath },
			}
		);
	}

	try {
		return toml.parse(utf8Text);
	} catch (cause) {
		throw new OperationalError(
			`Config file parsing error on line ${ cause.line } : ${ cause.column } : ${ cause.message } in file ${ filepath }`,
			{
				cause,
				info: {
					filepath,
					line: cause.line,
					column: cause.column,
					message: cause.message,
				},
			}
		);
	}
}
