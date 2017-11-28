'use strict';

/*

/:type/
GET collection.list
POST collection.create

/:type/:id
GET resource.get
PATCH resource.update
DELETE resource.remove

/:type/:id/relationships/:relationship
GET relationships.list
PATCH relationships.replace
POST relationships.append
DELETE relationships.remove

## /:type/

1. Return a 405 if the HTTP method is not accepted.
2. Set CORS headers.
3. Send back OPTIONS response if requested.
4. Accept and validate JSON API for POST
5. Create a transaction.
6. Authenticate user.
7. Authenticate scope.
8. Authorize user and scope.
9. Dispatch method: list, create.
10. Send back HEAD response if requested.
11. Handle JSON API error.
12. Send JSON API response (specific to relationships?).

## /:type/:id

1. Return a 405 if the HTTP method is not accepted.
2. Set CORS headers.
3. Send back OPTIONS response if requested.
4. Accept and validate JSON API for PATCH
5. Create a transaction.
6. Authenticate user.
7. Authenticate scope.
8. Authorize user and scope.
9. Dispatch method: get, update, remove.
10. Send back HEAD response if requested.
11. Handle JSON API error.
12. Send JSON API response (specific to relationships?).

## /:type/:id/relationships/:relationship

1. Return a 404 if the relationship does not exist.
2. Return a 405 if the HTTP method is not accepted.
3. Set CORS headers.
4. Send back OPTIONS response if requested.
5. Accept and validate JSON API for PATCH, POST, and DELETE
6. Create a transaction.
7. Authenticate user.
8. Authenticate scope.
9. Authorize user and scope.
10. Dispatch method: list, replace, append, remove.
11. Send back HEAD response if requested.
12. Handle JSON API error.
13. Send JSON API response (specific to relationships?).

*/
