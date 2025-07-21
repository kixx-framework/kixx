# Step 1: Application Configuration

## Overview

The first step in building a Kixx application is setting up the configuration files that define how your application behaves. Kixx uses a file-based configuration system that's simple, versionable, and environment-aware.

## Configuration Files

### kixx-config.json

The main application configuration file that defines your application's name, environment-specific settings, and custom configuration options.

> **⚠️ Warning:**  
> **Do not put secrets (such as API keys, passwords, or private tokens) in `kixx-config.json`.**  
> Instead, store all sensitive information in a separate `.secrets.json` file, which is loaded automatically by the framework.  
> This keeps your secrets out of version control and reduces the risk of accidental exposure.

```json
{
    "name": "MyApp",
    "procName": "myapp",
    "environments": {
        "development": {
            "logger": {
                "level": "debug",
                "mode": "console"
            },
            "server": {
                "port": 3000
            }
        },
        "production": {
            "logger": {
                "level": "info",
                "mode": "stdout"
            },
            "server": {
                "port": 3001
            }
        }
    },
    "customConfig": {
        "timezone": "America/New_York"
    }
}
```

#### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Human-readable application name |
| `procName` | string | Process name for system services |
| `environments` | object | Environment-specific configurations |
| `customConfig` | object | Application-specific configuration |

#### Environment Configuration

Each environment can have its own settings:

- **logger.level**: Logging level (`debug`, `info`, `warn`, `error`)
- **logger.mode**: Logging output (`console`, `stdout`, `file`)
- **server.port**: HTTP server port number

### virtual-hosts.json

Defines how different hostnames are routed to your application's routes. See more in [Routing Configuration](./step-4-routing-configuration.md).

```json
[
    {
        "name": "Main",
        "hostname": "com.myapp.www",
        "routes": [
            "app://main.json",
            "kixx://defaults.json"
        ]
    },
    {
        "name": "API",
        "hostname": "api.myapp.com",
        "routes": [
            "app://api.json"
        ]
    }
]
```

#### Virtual Host Options

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Human-readable hostname identifier |
| `hostname` | string | Domain name pattern to match |
| `routes` | array | List of route specifications or references to route configuration files |

#### Route References

- **app://** - Application-specific routes (from `routes/` directory)
- **kixx://** - Framework default routes. See [Routing Configuration](./step-4-routing-configuration.md) for the Kixx default routes.

### site-page-data.json

Contains site-wide data that's available on every page, such as navigation menus, contact information, and global settings.

```json
{
    "page": {
        "title": "My Application",
        "description": "A hypermedia-driven web application"
    },
    "nav_menu_sections": [
        {
            "label": "Main",
            "pages": [
                {
                    "label": "Home",
                    "url": "/"
                },
                {
                    "label": "About",
                    "url": "/about"
                }
            ]
        },
        {
            "label": "Services",
            "pages": [
                {
                    "label": "Products",
                    "url": "/products"
                },
                {
                    "label": "Contact",
                    "url": "/contact"
                }
            ]
        }
    ],
    "contactInfo": {
        "phone": {
            "raw": "555-123-4567",
            "formatted": "(555) 123-4567"
        },
        "email": "info@myapp.com",
        "address": {
            "street": "123 Main St",
            "city": "Anytown",
            "state": "NY",
            "zip": "12345"
        }
    },
    "social": {
        "twitter": "https://twitter.com/myapp",
        "facebook": "https://facebook.com/myapp",
        "linkedin": "https://linkedin.com/company/myapp"
    }
}
```

### .secrets.json

Contains sensitive configuration data that shouldn't be committed to version control.

```json
{
    "database": {
        "password": "your-db-password"
    },
    "api": {
        "secretKey": "your-api-secret"
    },
    "email": {
        "smtpPassword": "your-email-password"
    }
}
```

#### Security Best Practices for .secrets.json

1. **Never commit secrets** - Add `.secrets.json` to `.gitignore`
2. **Rotate secrets regularly** - Change passwords and keys periodically

## Next Steps

After completing the configuration setup, proceed to:

- [Step 2: Template System Setup](./step-2-template-system-setup.md)
- [Step 3: Page Structure](./step-3-page-structure.md)
- [Step 4: Routing Configuration](./step-4-routing-configuration.md) 
