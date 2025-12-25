The `app-server` command will start the
HTTP web application server for your project.

Options
-------

--port (-p) *optional*
    The port to attach your HTTP server on.

--dir (-d) *optional*
    The path to your application directory.

    If not provided, Kixx will assume the current working directory is your
    application directory. And, unless overridden by --config or --secrets
    the configuration and secrets files will be expected in this directory as
    "kixx-config.jsonc" and ".secrets.jsonc" as well as other
    conventional application folders.

--environment (-e) *optional*
    The configuration environment you would like to use.

    The default value is "production".

    You can create different sections in your kixx-config.jsonc file to set
    configurations for different environments. Typically values like
    "production" and "development" are common, but you might want to add
    your own like "staging", or "test".

--config (-c) *optional*
    The file path to your application configuration file.

    If not provided, the config file will be assumed to be in the
    application directory as "kixx-config.jsonc".

--secrets (-s) *optional*
    The file path to your application secrets file.

    If not provided, the secrets file will be assumed to be in the
    application directory as ".secrets.jsonc".
