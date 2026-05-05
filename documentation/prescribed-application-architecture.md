# Prescribed Application Architecture

## Domain Logic: Service Layer and Transaction Scripts
Application domain logic is primarily organized using the Transaction Script pattern within a Service Layer.

The Service Layer defines an application's boundary and available operations. It encapsulates business logic, transactions, and data access.

Use cases are bundled into Services and each public method on a Service implements a Transaction Script. A Transaction Script is a procedure that takes input or a request from the Presentation Layer, validates it, processes it, accesses the database, executes business logic, and returns something.

Each class organized into the Service Layer is a Service and the name should end with "Service", like "DocumentArchiveService".

The Transaction Script methods are a good place to put transaction control, logging, access control, and other security considerations.

A Transaction Script method should update the state of the system, or return a view of the system. A method which does both is a code smell.

The Transaction Script method pattern has several advantages over other patterns like Domain Model or Active Record:

- The Transaction Script methods are procedures which are easy to follow, all in one place.
- It is not concerned with database mapping, and uses a simple Data Gateway approach instead.
- The Transactional Boundaries are easy to see; start the procedure by opening a transaction and end by closing it.

A perceived disadvantage of Transaction Scripts is that they often result in duplicated code. But, I don't think code duplication is the sin we've thought it to be. Code is often simpler and requires less cognitive loading when we keep it together as much as we can, rather than refactoring into a single place for multiple uses. When we refactor duplicated code into a single location, then, whenever we see a method call another, we need to go find that dependency and understand what it does.

## Data Source: Collections, Data Stores, and Adapters

We want to separate the data access logic (SQL, document store, KV store, etc.) from the domain logic. Mixing them causes all sorts of problems which are very difficult to refactor later.

We generalize data storage into two different pardigms:

1. Document Store - Documents are structured bags of data serialized as JSON. Indexing is achieved through the use of mapping functions in views.
2. Object Store - Objects are any datatype. The mimetype and other related metadata is indexed and qeuried.

Each of these storage paradigms is called a Data Store, and lives in the Data Store layer. Each storage paradigm has a backing Adapter, which implements the Data Store for the target platform. For instance, the Document Store uses the Node.js SQLite engine when running in Node.js or the Cloudflare D1 engine when running in a Cloudflare Worker. The Object Store could be backed by the local filesystem, AWS S3, Cloudflare R1, or something similar.

Datastore Adapters are typically implemented as plugins, where the application and framework logic doesn't even need to know of their existance. This also provides a nice way to use the Service Stub pattern for testing.

An application can introduce additional data storage paradigms for special use cases. This could be a SQL engine, or other optimizes storage system for the application. Applications will typically want to follow the same pattern of accessing the specialized Data Store through a Gateway to keep data access logic from leaking into domain logic.

Specialized Data Stores may not need to use an Adapter if the deployment targets remain similar. For example, a SQL Data Store could use PostgreSQL in local development, staging, and production.

The Transaction Scripts then access data through Collections which implement a Data Gateway pattern. Collections deal only with data and data access. No domain logic should exist in a Collection. This is very different than the Active Record pattern, where domain logic and database mapping live in the same layer. Instead of mixing these concerns, Collections only provide access to the underlying Data Stores, encapsulating data access patterns and keeping the logic out of the Transaction Scripts in the Service Layer.

Typically, each Collection represents a document or object type in the underlying Data Store, but it could represent multiple types, depending on the data access patterns needed by the Transaction Scripts in the Service Layer. A Collection usually implements the expected create, read, update, and delete methods, but may also offer more complicated query options, or compound data update methods.

Each Collection has at least one Record which it deals with. A Record is an implementation of the Data Mapper and Data Transfer Object patterns, and typically represents a Document or Object of a specific type in the underlying Data Store.
