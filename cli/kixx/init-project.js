import process from 'node:process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as jsonc from '../../lib/vendor/jsonc-parser/mod.mjs';
import * as TemplateEngine from '../../lib/template-engine/mod.js';
import { isNonEmptyString } from '../../lib/assertions/mod.js';

const PROJECT_DIR = process.cwd();
const ROOT_DIR = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
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

    const packageJson = await readPackageJson();

    const appName = values.name || packageJson.name;

    if (!isNonEmptyString(appName)) {
        console.error("We'll need a name for your project.");
        console.error('No name option was provided and the package.json file does not contain a name property');
        process.exit(1);
    }

    const processName = appName.replace(/[^a-z0-9]/g, '').slice(0, 12);

    await createReadme(appName);
    await createKixxConfig(appName, processName);
    await createSitePageData(appName);
}

async function createReadme(applicationName) {
    const destPathname = path.join(PROJECT_DIR, 'README.md');
    const destExists = await statFile(destPathname);

    if (destExists) {
        return false;
    }

    const srcPathname = path.join(TEMPLATE_DIR, 'README.md');
    let textContent = await fsp.readFile(srcPathname, 'utf8');
    const template = compileTemplate('README.md', textContent);
    textContent = template({ applicationName });

    await fsp.writeFile(destPathname, textContent, 'utf8');
}

async function createKixxConfig(appName, processName) {
    const srcPathname = path.join(TEMPLATE_DIR, 'kixx-config.jsonc');
    let textContent = await fsp.readFile(srcPathname, 'utf8');

    let diff = jsonc.modify(textContent, [ 'name' ], appName, {});
    textContent = jsonc.applyEdits(textContent, diff);

    diff = jsonc.modify(textContent, [ 'processName' ], processName, {});
    textContent = jsonc.applyEdits(textContent, diff);

    const destPathname = path.join(PROJECT_DIR, 'kixx-config.jsonc');

    await fsp.writeFile(destPathname, textContent, 'utf8');
}

async function createSitePageData(appName) {
    const srcPathname = path.join(TEMPLATE_DIR, 'site-page-data.jsonc');
    let textContent = await fsp.readFile(srcPathname, 'utf8');

    const diff = jsonc.modify(textContent, [ 'title' ], appName, {});
    textContent = jsonc.applyEdits(textContent, diff);

    const destPathname = path.join(PROJECT_DIR, 'site-page-data.jsonc');

    await fsp.writeFile(destPathname, textContent, 'utf8');
}

function compileTemplate(templateId, utf8) {
    const tokens = TemplateEngine.tokenize(null, templateId, utf8);
    const tree = TemplateEngine.buildSyntaxTree(null, tokens);
    return TemplateEngine.createRenderFunction(null, new Map(), new Map(), tree);
}

function copyFileIfNotExists() {
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
    try {
        const content = await fsp.readFile(filepath, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Error reading package.json');
            console.error(error.name, ':', error.message);
            process.exit(1);
        }
        return {};
    }
}
