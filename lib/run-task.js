'use strict';

const Promise = require(`bluebird`);
const ProgrammerError = require(`./classes/programmer-error`);
const Logger = require(`./classes/logger`);
const Filepath = require(`filepath`);
const composeMiddleware = require(`./compose-middleware`);
const {append, assoc, complement, difference, has, isFunction, last} = require(`../library`);

const isNotFunction = complement(isFunction);
const notHas = complement(has);

module.exports = function runTask(options, filename, taskName) {
	const logger = Logger.create().update({prettyLog: true});
	const registeredNames = [];
	const executedTasks = [];
	const tasks = Object.create(null);

	const taskDefinitionFile = Filepath.create(filename);

	let defineTasks;
	try {
		defineTasks = require(taskDefinitionFile.path);
	} catch (err) {
		throw new ProgrammerError(
			`Could not load task definition file '${taskDefinitionFile}': ${err.message}`
		);
	}

	if (isNotFunction(defineTasks)) {
		throw new ProgrammerError(
			`Expected task definition file '${taskDefinitionFile}' to export a single Function`
		);
	}

	defineTasks(function createTask(name) {
		if (registeredNames.includes(name)) {
			throw new ProgrammerError(
				`A task with name '${name}' already exists.`
			);
		}

		registeredNames.push(name);

		const dependencies = Array.prototype.slice.call(arguments, 1);
		const fn = isFunction(last(dependencies)) ? dependencies.pop() : null;

		function invokeTask(args, resolve, reject) {
			if (executedTasks.includes(invokeTask)) return resolve(args);
			executedTasks.push(invokeTask);

			if (isNotFunction(fn)) return resolve(args);

			function resolver(result) {
				return resolve(assoc(name, result, args));
			}

			try {
				fn(args, resolver, reject);
			} catch (err) {
				err.message = `Error in task '${name}': ${err.message}`;
				return reject(err);
			}

			return null;
		}

		tasks[name] = {name, dependencies, invokeTask};
	});

	if (notHas(taskName, tasks)) {
		throw new ProgrammerError(
			`No tasks defined for "${taskName}"`
		);
	}

	function walkTaskDefinitions(taskRunners, taskName) {
		const {dependencies, invokeTask} = tasks[taskName];

		if (dependencies && dependencies.length > 0) {
			const diff = difference(dependencies, Object.keys(tasks));
			if (diff.length > 0) {
				throw new ProgrammerError(
					`The task dependency "${diff[0]}" (required by task "${taskName}") has not been defined.`
				);
			}
			taskRunners = dependencies.reduce(walkTaskDefinitions, taskRunners);
		}

		return append(invokeTask, taskRunners);
	}

	return new Promise((resolve, reject) => {
		const functions = walkTaskDefinitions([], taskName);

		function onComplete(err, result) {
			if (err) return reject(err);
			return resolve(result);
		}

		return composeMiddleware(functions, onComplete)({logger});
	});
};
