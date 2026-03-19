import * as plugin from '../../../../lib/node/hyperview-local-store/plugin.js';
import { testPluginConformance } from '../../../conformance/plugin.js';


// The plugin module exports named functions register() and initialize() directly,
// matching the Plugin port shape.
testPluginConformance(() => plugin);
