// TODO: How much of the Hyperview storage structure be moved into the
//       Content-Addressable store? Does HyperviewPage move here?
export default class ContentAddressableStore {

    async getPage(context, pathname) {
        assertCanonicalPagePathname(
            pathname,
            'ContentAddressableStore#getPage():',
        );

        // We need to get the page data for this page - the page at `pathname` - and
        // all its parent pages. So for pathname "/blog/reviews/music/led-zeppelin" we need:
        //
        // /page.json
        // /blog/page.json
        // /blog/reviews/page.json
        // /blog/reviews/music/page.json
        // /blog/reviews/music/led-zeppelin/page.json
        const parts = pathname.split('/').filter((part) => part);

        const filepaths = [];
        let path;

        // Always start with the root page metadata item.
        filepaths.push(normalizePagePath('page.json'));

        for (const part of parts) {
            // All page data filepaths are prefixed with "pages"
            // in content-addressable storage.
            path = path ? `${ path }/${ part }` : part;
            filepaths.push(normalizePagePath(`${ path }/page.json`));
        }

        // We don't need to get the page leaf node page.json separately, because we'll
        // be fetching everything in the `pages/${ pathname }` directory, including
        // the leaf page.json file. But, we can do a cheap check to make sure it
        // exists before proceeding.
        const leafPage = filepaths.pop();
        const leafPageStat = await statPath(context, leafPage);

        if (!leafPageStat) {
            return null;
        }

        const parentStats = [];
        for (const parentFilepath of filepaths) {
            const stat = await statPath(context, parentFilepath);
            // Not all parent pages have a page.json file.
            if (stat) {
                parentStats.push(stat);
            }
        }

        const directory = normalizePagePath(pathname);

        const sourceFileStats = await listByPathPrefix(context, directory, {
            readCacheTtlSeconds,
        });

        const hashesToFetch = parentStats
            .concat(sourceFileStats)
            .map(({ hash }) => hash);

        const files = await getBatchByHashes(context, hashesToFetch);

        const pageDataFiles = [];
        let partials = [];
        let includes = {};

        for (const file of files) {
            const { filepath } = file;
            if (filepath.startsWith('pages/') && filepathBasename(filepath) === 'page.json') {
                pageDataFiles.push({
                    filepath: denormalizePagePath(filepath),
                    json: file.json,
                });
            }
            if (filepathBasename(filepath) === PAGE_PARTIALS_MANIFEST) {
                partials = decodeFileBundle(file.json);
            }
            if (filepathBasename(filepath) === PAGE_INCLUDES_MANIFEST) {
                includes = decodeFileBundle(file.json);
            }
        }

        const directoryStat = await statPath(context, directory);
        // Include the page leaf directory with the parent page.json filepaths to
        // accumulate the dependencies list.
        const dependencies = parentStats.concat([ directoryStat ]);

        const digest = computeDigest(dependencies);

        return {
            digest,
            pageDataFiles,
            partials,
            includes,
        };
    }
}
