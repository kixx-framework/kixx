import createApplicationServer from './lib/create-application-server.mjs';
import createAppRouter from './lib/components/create-app-router.mjs';
import createLocalFileRecordStore from './lib/components/create-local-file-record-store.mjs';
import createTemplatePageHandler from './lib/components/create-template-page-handler.mjs';
import createLocalFileTemplateStore from './lib/components/create-local-file-template-store.mjs';

export default {
	createApplicationServer,
	createAppRouter,
	createLocalFileRecordStore,
	createLocalFileTemplateStore,
	createTemplatePageHandler,
};
