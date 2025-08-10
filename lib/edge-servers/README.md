# Kixx Edge Servers

## Dev Server
You can start multiple dev servers on different ports, each will assign a different, pre-configured hostname to the `x-forwarded-host` header for sending the request on to your backend application server. You can configure this in your kixx-config.jsonc in the "devServers" list:

```jsonc
{
    "name": "My App",
    // The processName will be included in log output as well as the sytem process lists.
    // This makes it easier to identify your app in the system process list or log files.
    "processName": "myapp",
    // You can specify multiple development servers to route requests to different
    // virtual hosts for development and testing.
    "devServers": [
        { "port": 3000, "forwardedHost": "www.kixx.dev" },
        { "port": 3001, "forwardedHost": "kixx.dev" }
    ],
    // The environments sections contains the configuration for each environment.
    "environments": {
        "development": {
            "logger": {
                "level": "debug",
                "mode": "console"
            }
        },
        "production": {
            "logger": {
                "level": "info",
                "mode": "stdout"
            }
        }
    }
}
```

If there is no "devServers" list in your kixx-config.json, then the `x-forwarded-host` header will be set to "localhost" and invoke the default vhost route for your application server as the first vhost defined in virtual-hosts.jsonc .
