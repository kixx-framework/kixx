## Admin API
The admin API is used for managing admin users, credentials, and API tokens.

### Accept an Admin User Invite

POST /admin-api/v1/users/invite/

This endpoints complements the existing HTML flow for accepting admin user invites to allow for CLI tool access.

The `Authorization: Bearer` header holds the invite/bootstrap token.

Content type `application/vnd.api+json` is required. The POST body and reply should be fully JSON:API 1.1 compliant.

type: "AdminUser"
attributes:
    - emailAddress (required)
    - password (required)

### Create a publishing API Token

POST /admin-api/v1/publishing-api-tokens/

This endpoint will require the user emailAddress and password for authentication. The user must already exist, and must be an admin user.

What is the best way to include the emailAddress and password for this request? Maybe encode them in an Authorization header? Authorization Basic?

Content type `application/vnd.api+json` is required. The POST body and reply should be fully JSON:API 1.1 compliant.

type: "PublishingApiToken"
attributes:
    - permissions (required) - An Array of objects, similar to AWS permissions
    - timeToLiveSeconds (optional) - Number of seconds until the token expires

Are there any other attributes which should be included in the payload?

A token must be created with the ID of the user which granted it stored with the token record for auditing purposes.

The object shape for a permission is { effect: "allow|deny", action: ["array of action URNs"], resource: "Resource URN string" }

For this first iteration, the only supported permission value is `{ effect: 'allow', action: ['*'], resource: '*' }`, allowing all actions on all resources. As the API surface grows, we'll add more explicit actions and resources in later iterations.

The returned payload should include an API token to use in future publishing API requests.

## Publishing API

All endpoints require an publishing API token on the `Authorization: Bearer`

### Put a Template

Accepts `text/plain` or `text/html`, but no other content types.

PUT `/publishing-api/v1/templates/base/*filepath` - Put a base template
PUT `/publishing-api/v1/templates/pages/*filepath` - Put a page template
PUT `/publishing-api/v1/templates/partials/*filepath` - Put a partial template

These endpoints will require a buildId value for namespacing (see the HyperviewService for more info). What's the best way to include that in this request envelope? As an HTTP header?

The response should be fully JSON:API 1.1 compliant.

### Put a Page Metadata File

PUT `/publishing-api/v1/pages/*pathname`

Content type `application/vnd.api+json` is required. The POST body and reply should be fully JSON:API 1.1 compliant.

type: "PageMetadata"
attributes: Accepts an arbitrary bag of JSON data which then becomes the `page.json` file for the given filepath.

### Put an Included Content File

PUT `/publishing-api/v1/includes/*filepath`

Accept any text based content type.

These endpoints accept an optional buildId value for namespacing (see the HyperviewService for more info). What's the best way to include that in this request envelope? As an HTTP header?

The response should be fully JSON:API 1.1 compliant.
