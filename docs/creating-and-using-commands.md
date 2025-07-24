# Creating and using commands

To implement a command create a new file in your application's `commands/` directory with a name that matches your desired command name. So, for a command called "get-user" we will create this file:

`commands/get-user.js`:

```javascript
export const options = {
    'include-email': {
        short: 'i',
        type: 'boolean',
        default: false,
    },
};

export async function run(context, optionParams, ...positionalParams) {
    const db = context.getService('kixx.Datastore');
    const userId = positionalParams[0];

    const userDocument = await db.getItem(`users__${ userId }`);

    if (!optionParams['include-email']) {
        delete userDocument.email;
    }

    console.log(JSON.stringify(userDocument));
}
```

## Invoking a command
You can run a command by invoking the `kixx` command line executable with the `run` sub command:

__Help line:__

```
$ kixx run <command_name> --flags-and-options [positional_args]
```

__Example:__

```
$ kixx run get-user "user:123" --include-email
```

## Defining command line option parsing rules
A command file starts by defining and exporting the command line options parsing rules for your command. Each rule can be defined by the following properties:

- `type` *string* Type of argument, which must be either boolean or string.
- `multiple` *boolean* Whether this option can be provided multiple times. If true, all values will be collected in an array. If false, values for the option are last-wins. Default: false.
- `short` *string* A single character alias for the option.
- `default` *string* | *boolean* | *string[]* | *boolean[]* The default value to be used if (and only if) the option does not appear in the arguments to be parsed. It must be of the same type as the type property. When multiple is true, it must be an array.

__Example:__

```javascript
export const options = {
    'include-email': {
        short: 'i',
        type: 'boolean',
        default: false,
    },
};
```

## Defining the command run function
Secondly you'll need to export a function called `run()`. The function can optionally be asynchronous. It follows this call signature:

```javascript
/**
 * @param  {Context} context           The Kixx Application Context object.
 * @param  {Object}  optionParams      Parsed command line options.
 * @param  {...[]}   positionalParams  Positional command line arguments.
 */
export async function run(context, optionParams, ...positionalParams) {
}
````
