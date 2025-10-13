## JSDoc Guidelines
Here are some core principles to follow for writing effective JSDoc comments for Node.js programs in JavaScript.

## Document the Contract, Not the Implementation
Focus on *what* your function does and *how* to use it, not *how* it works internally. Your JSDoc should serve as a contract between your code and its consumers.

```javascript
/**
 * Calculates the total price including tax and discounts
 * @param {number} basePrice - The original price before adjustments
 * @param {number} taxRate - Tax rate as a decimal (e.g., 0.08 for 8%)
 * @param {number} [discount=0] - Discount amount to subtract
 * @returns {number} The final price after tax and discount
 */
function calculateTotal(basePrice, taxRate, discount = 0) {
  // Implementation details don't belong in JSDoc
}
```

## Be Precise with Types
Node.js development often involves complex data structures. Be specific about object shapes, array contents, and union types. Write @typedef blocks to document these structures:

```javascript
/**
 * @typedef {Object} UserProfile
 * @property {string} id - Unique user identifier
 * @property {string} email - User's email address
 * @property {string[]} roles - Array of role names
 * @property {Date} createdAt - Account creation timestamp
 */

/**
 * @param {UserProfile|null} user - User object or null if not found
 * @returns {Promise<boolean>} True if user has admin privileges
 */
function userHasAdminPrivileges(user) {
}
```

## Document Error Conditions and Edge Cases
Documentation for error conditions and edge cases is crucial for Node.js applications where error handling is paramount:

```javascript
/**
 * Reads and parses a JSON configuration file
 * @param {string} filePath - Path to the JSON file
 * @returns {Promise<Object>} Parsed configuration object
 * @throws {Error} When file doesn't exist or contains invalid JSON
 * @throws {TypeError} When filePath is not a string
 */
```

## Keep It Concise
Write concise descriptions that add value beyond the name of the thing you are documenting. Keeping it concise will help your documentation remain relevant longer too.

**Bad:**
```javascript
/**
 * This function takes a user ID parameter and returns user data
 */
```

**Good:**
```javascript
/**
 * Retrieves user data from the database with role information populated
 */
```

## Document Async Behavior Clearly
In Node.js, async patterns are everywhere. Mark async functions and methods with the @async tag and be explicit about what your Promises resolve to:

```javascript
/**
 * @async
 * @param {string} userId 
 * @returns {Promise<UserProfile|null>} Resolves to user profile or null if not found
 * @throws {DatabaseError} When database connection fails
 */
async function getUser(userId) {
}
```

## Summary
The key insight we've gained over the years is that good JSDoc comments make your code self-documenting and reduce the cognitive load for other developers (including your future self). They should answer the questions: "What does this do?", "How do I use it?", and "What can go wrong?"
