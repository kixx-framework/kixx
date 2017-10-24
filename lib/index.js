'use strict';

exports.ProgrammerError = require(`./lib/classes/programmer-error`);
exports.FrameworkError = require(`./lib/classes/framework-error`);

exports.Library = require(`./lib/library`);

exports.composeMiddleware = require(`./lib/compose-middleware`);
exports.createProcessManager = require(`./lib/create-process-manager`);
exports.defineFunction = require(`./lib/define-function`);
exports.startHttpServer = require(`./lib/start-http-server`);
