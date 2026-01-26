import process from 'node:process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as jsonc from '../lib/vendor/jsonc-parser/mod.mjs';
import * as TemplateEngine from '../lib/kixx-templating/mod.js';
import { isNonEmptyString } from '../lib/assertions/mod.js';

const CLI_DIR = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.join(CLI_DIR, 'docs');
const PROJECT_DIR = process.cwd();
const ROOT_DIR = path.dirname(CLI_DIR);
const TEMPLATE_DIR = path.join(ROOT_DIR, 'project-template');

const options = {
    // A name for the project.
    name: {
        short: 'n',
        type: 'string',
    },
};

/* eslint-disable no-console */

export async function main(args) {
    const { values } = parseArgs({
        args,
        options,
        strict: false,
        allowPositionals: false,
        allowNegative: true,
    });

    if (values.help) {
        console.log(readDocFile('init-project.md'));
        process.exit(1);
        return;
    }

    const packageJson = await readPackageJson();

    // Use the project name from package.json if no name is provided.
    const appName = values.name || packageJson.name;

    if (!isNonEmptyString(appName)) {
        console.error("We'll need a name for your project.");
        console.error('No name option was provided and the package.json file does not contain a name property');
        process.exit(1);
    }

    const processName = appName.toLowerCase().replace(/[^a-z0-9]/g, '');

    await createReadme(appName);
    await createKixxConfig(appName, processName);
    await createSitePageData(appName);
    await copyFileIfNotExists(path.join(TEMPLATE_DIR, 'virtual-hosts.jsonc'), path.join(PROJECT_DIR, 'virtual-hosts.jsonc'));
    await copyDirectoryRecursive(path.join(TEMPLATE_DIR, 'pages'), path.join(PROJECT_DIR, 'pages'));
    await copyDirectoryRecursive(path.join(TEMPLATE_DIR, 'templates'), path.join(PROJECT_DIR, 'templates'));
    await copyDirectoryRecursive(path.join(TEMPLATE_DIR, 'routes'), path.join(PROJECT_DIR, 'routes'));
    await copyDirectoryRecursive(path.join(TEMPLATE_DIR, 'app'), path.join(PROJECT_DIR, 'app'));
}

async function createReadme(applicationName) {
    const destPathname = path.join(PROJECT_DIR, 'README.md');
    const destExists = await statFile(destPathname);

    if (destExists) {
        // Do not update the README.md if it already exists.
        return false;
    }

    const srcPathname = path.join(TEMPLATE_DIR, 'README.md');
    let textContent = await fsp.readFile(srcPathname, 'utf8');
    const template = compileTemplate('README.md', textContent);
    textContent = template({ applicationName });

    await fsp.writeFile(destPathname, textContent, 'utf8');
}

async function createKixxConfig(appName, processName) {
    const destPathname = path.join(PROJECT_DIR, 'kixx-config.jsonc');
    const srcPathname = path.join(TEMPLATE_DIR, 'kixx-config.jsonc');

    let textContent = await readUtf8File(destPathname);
    if (!textContent) {
        textContent = await readUtf8File(srcPathname);
    }

    // If the kixx config file already exists, then we just update the
    // "name" and "processName" fields.

    let diff = jsonc.modify(textContent, [ 'name' ], appName, {});
    textContent = jsonc.applyEdits(textContent, diff);

    diff = jsonc.modify(textContent, [ 'processName' ], processName, {});
    textContent = jsonc.applyEdits(textContent, diff);

    await writeUtf8File(destPathname, textContent);
}

async function createSitePageData(appName) {
    const pagesDirectory = path.join(PROJECT_DIR, 'pages');
    const destPathname = path.join(pagesDirectory, 'page.jsonc');
    const srcPathname = path.join(TEMPLATE_DIR, 'pages', 'page.jsonc');

    let textContent = await readUtf8File(destPathname);
    if (!textContent) {
        textContent = await readUtf8File(srcPathname);
    }

    // If the site page data file already exists, then we just update the
    // "title" field.

    const diff = jsonc.modify(textContent, [ 'title' ], appName, {});
    textContent = jsonc.applyEdits(textContent, diff);

    const dirExists = await statFile(pagesDirectory);
    if (!dirExists) {
        await fsp.mkdir(pagesDirectory, { recursive: true });
    }
    await writeUtf8File(destPathname, textContent);
}

function compileTemplate(templateId, utf8) {
    const tokens = TemplateEngine.tokenize(null, templateId, utf8);
    const tree = TemplateEngine.buildSyntaxTree(null, tokens);
    return TemplateEngine.createRenderFunction(null, new Map(), new Map(), tree);
}

async function copyDirectoryRecursive(sourceDir, destDir, exclude = []) {
    // Ensure destination directory exists
    await fsp.mkdir(destDir, { recursive: true });

    const entries = await fsp.readdir(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
        const sourcePath = path.join(sourceDir, entry.name);

        if (exclude.includes(sourcePath)) {
            continue;
        }

        const destPath = path.join(destDir, entry.name);

        if (entry.isDirectory()) {
            // eslint-disable-next-line no-await-in-loop
            await copyDirectoryRecursive(sourcePath, destPath);
        } else if (entry.isFile()) {
            // eslint-disable-next-line no-await-in-loop
            await copyFileIfNotExists(sourcePath, destPath);
        }
    }
}

async function copyFileIfNotExists(sourcePathname, destPathname) {
    try {
        await fsp.copyFile(sourcePathname, destPathname, fsp.constants.COPYFILE_EXCL);
    } catch (error) {
        if (error.code !== 'EEXIST') {
            throw error;
        }
    }
}

async function statFile(filepath) {
    try {
        const stat = await fsp.stat(filepath);
        return stat;
    } catch {
        return null;
    }
}

async function readPackageJson() {
    const filepath = path.join(PROJECT_DIR, 'package.json');
    let json;
    try {
        json = await readUtf8File(filepath);
    } catch (error) {
        console.error('Error reading', filepath);
        console.error(error.name, ':', error.message);
        process.exit(1);
    }

    if (!json) {
        return null;
    }

    try {
        return JSON.parse(json);
    } catch (error) {
        console.error('Error parsing', filepath);
        console.error(error.name, ':', error.message);
        process.exit(1);
    }
}

async function readUtf8File(filepath) {
    let utf8;
    try {
        utf8 = await fsp.readFile(filepath, 'utf8');
    } catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
    return utf8;
}

async function writeUtf8File(filepath, data) {
    await fsp.writeFile(filepath, data, { encoding: 'utf8' });
}

function readDocFile(filename) {
    const filepath = path.join(DOCS_DIR, filename);
    return fs.readFileSync(filepath, { encoding: 'utf8' });
}
