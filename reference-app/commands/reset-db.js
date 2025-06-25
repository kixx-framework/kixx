import path from 'node:path';
import fileSystem from '../../mod.js';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

const DIRECTORIES = [
    path.join(DIR, 'data', 'kv-store'),
    path.join(DIR, 'data', 'jobs'),
];


export const options = {};

export async function run(context) {
    const db = context.getService('kixx.Datastore');

    await clearDatastore();
    await loadImages(db, path.join(DIR, 'fixtures', 'images.json'));
}

async function clearDatastore() {
    const promises = DIRECTORIES.map(clearDirectory);
    await Promise.all(promises);
}

async function loadImages(db, sourceFilepath) {
    const images = await fileSystem.readJSONFile(sourceFilepath);
    const promises = images.map((image) => {
        return loadImage(db, image);
    });
    await Promise.all(promises);
}

async function loadImage() {
}

async function clearDirectory(dirpath) {
    const filepaths = await fileSystem.readDirectory(dirpath);
    const promises = filepaths.map(fileSystem.removeFile);
    await Promise.all(promises);
}
