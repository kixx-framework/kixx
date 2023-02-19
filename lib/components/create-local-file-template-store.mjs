import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import Handlebars from 'handlebars';

export default function createLocalFileTemplateStore(spec) {
	const { directory } = spec;

	fs.mkdirSync(directory, { recursive: true });

	async function safelyReadDirectory(dirname) {
		let entries;

		try {
			entries = await fsp.readdir(dirname);
		} catch (cause) {
			if (cause.code === 'ENOENT') {
				return [];
			}

			throw cause;
		}

		return entries.map((entry) => path.join(dirname, entry));
	}

	async function registerPartialTemplates(handlebars) {
		const filepaths = await safelyReadDirectory(path.join(directory, 'partials'));

		const promises = filepaths.map((filepath) => {
			return registerPartial(handlebars, filepath);
		});

		return Promise.all(promises);
	}

	async function registerPartial(handlebars, filepath) {
		const name = path.basename(filepath, '.html');
		const html = await fsp.readFile(filepath, { encoding: 'utf8' });

		handlebars.registerPartial(name, html);
		return true;
	}

	async function registerTemplateHelpers(handlebars) {
		const filepaths = await safelyReadDirectory(path.join(directory, 'helpers'));

		const promises = filepaths.map((filepath) => {
			return registerHelper(handlebars, filepath);
		});

		return Promise.all(promises);
	}

	async function registerHelper(handlebars, filepath) {
		const { name, helper } = await import(filepath);

		handlebars.registerHelper(name, helper);
		return true;
	}

	async function compileTemplate(handlebars, pageDirectory) {
		const filepath = path.join(pageDirectory, 'page.html');
		const html = await fsp.readFile(filepath, { encoding: 'utf8' });
		return handlebars.compile(html);
	}

	return {
		async getTemplate(id) {
			const handlebars = Handlebars.create();

			// The page directory. Ex: sites/adkavy/pages/home/
			const pagePathParts = id.split('/');
			const pageDirectory = path.join(directory, 'pages', ...pagePathParts);

			await registerPartialTemplates(handlebars);
			await registerTemplateHelpers(handlebars);

			return compileTemplate(handlebars, pageDirectory);
		},
	};
}
