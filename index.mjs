import { ErrorEvent, InfoEvent, DebugEvent } from './lib/events.mjs';
import EventBus from './lib/event-bus.mjs';
import createApplicationServer from './lib/create-application-server.mjs';

import { createLocalFileRecordStore } from './lib/storage-engines/local-file-record-store.mjs';
import { createHandlebarsTemplateEngine } from './lib/template-engines/handlebars-template-engine.mjs';

import { createRecordStore } from './lib/components/record-store.mjs';
import { createTemplateStore } from './lib/components/template-store.mjs';
import { createAppRouter } from './lib/components/app-router.mjs';

import { createTemplatePageHandler } from './lib/request-handlers/template-page-handler.mjs';
import { createStaticFileHandler } from './lib/request-handlers/static-file-handler.mjs';

import BaseEntityType from './lib/entity-types/base-entity-type.mjs';
import Page from './lib/entity-types/page.mjs';
import PageImage from './lib/entity-types/page-image.mjs';

export default {
	Events: {
		ErrorEvent,
		InfoEvent,
		DebugEvent,
	},

	EventBus,

	createApplicationServer,
	createAppRouter,
	createTemplateStore,
	createRecordStore,

	storageEngines: {
		createLocalFileRecordStore,
	},
	templateEngines: {
		createHandlebarsTemplateEngine,
	},
	requestHandlers: {
		createTemplatePageHandler,
		createStaticFileHandler,
	},
	entityTypes: {
		BaseEntityType,
		Page,
		PageImage,
	},
};
