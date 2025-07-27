# Inline code comment guidelines
Here are our core guidelines for inline code comments:

## Write Comments That Reduce Cognitive Load
The most valuable inline comments help readers understand code without having to hold too many details in their head simultaneously. This is especially crucial in Node.js where async flows and complex state transformations are common:

```javascript
// Stack after auth: [user, session, permissions]
const permissions = await getUserPermissions(user.id);
// Stack after permissions: [user, session, permissions, roles]
const roles = await expandPermissions(permissions);
```

## Explain the "Why," Not Just the "What"
Focus on documenting why some code exists, and why it is doing what it does rather than what it is doing. This is especially true when the code does something that seems counterintuitive or requires domain knowledge:

```javascript
// Increment DB counter BEFORE processing to ensure we don't 
// get stuck on the same database if we hit the time limit
currentDb = (currentDb + 1) % totalDatabases;
const db = databases[currentDb];
await processExpiredKeys(db);
```

## Use "Teacher Comments" for Domain Knowledge
When your code involves concepts that might be outside typical JavaScript/Node.js knowledge:

```javascript
// JWT exp claim uses NumericDate format (seconds since epoch)
// JavaScript Date.now() returns milliseconds, so we divide by 1000
const expiry = Math.floor(Date.now() / 1000) + (60 * 60 * 24); // 24 hours
```

## Document State Transitions and Side Effects
Particularly important in Node.js applications with complex state management:

```javascript
// After this call, the connection state changes to 'authenticating'
// and subsequent messages will be queued until auth completes
await connection.startAuthentication(credentials);

// Connection is now in 'authenticating' state - messages are queued
const result = await sendCommand('GET_STATUS');
```

## Add "Checklist Comments" for Coordinated Changes
When modifying one piece of code requires changes elsewhere:

```javascript
const EVENT_TYPES = {
  USER_LOGIN: 'user:login',
  USER_LOGOUT: 'user:logout'
  // WARNING: When adding event types here, also update:
  // - src/analytics/event-handlers.js
  // - tests/fixtures/events.json
  // - docs/api/events.md
};
```

## Use Guide Comments to Break Up Complex Logic
Help readers follow the flow of complex functions:

```javascript
async function processPayment(order, paymentMethod) {
  // Validate payment details and customer eligibility
  await validatePaymentMethod(paymentMethod);
  await checkCustomerCredit(order.customerId);
  
  // Calculate final amounts including taxes and fees
  const taxAmount = calculateTax(order);
  const processingFee = calculateFee(paymentMethod, order.total);
  const finalAmount = order.total + taxAmount + processingFee;
  
  // Process the actual payment transaction
  const transaction = await chargePayment(paymentMethod, finalAmount);
  
  // Update order status and send notifications
  await updateOrderStatus(order.id, 'paid', transaction.id);
  await sendPaymentConfirmation(order.customerId, transaction);
  
  return transaction;
}
```

## Avoid Trivial Comments
Don't state what's obvious from the code:

```javascript
// Bad
user.name = 'John'; // Set the user name to John

// Good  
user.name = sanitizeInput(rawName); // Remove potential XSS vectors
```

## Document Workarounds and Hacks
When you have to do something non-obvious due to external constraints:

```javascript
// Workaround: Some legacy clients send timestamps as strings
// TODO: Remove this once all clients upgrade to v2.0+
const timestamp = typeof data.timestamp === 'string' 
  ? parseInt(data.timestamp, 10) 
  : data.timestamp;
```

## Explain Performance or Memory Considerations
Especially important in Node.js applications:

```javascript
// Pre-allocate buffer to avoid multiple reallocations
// during high-frequency writes (saves ~40% memory churn)
const buffer = Buffer.allocUnsafe(expectedSize);

// Process in chunks to avoid blocking the event loop
for (let i = 0; i < items.length; i += CHUNK_SIZE) {
  const chunk = items.slice(i, i + CHUNK_SIZE);
  await processChunk(chunk);
  
  // Yield control back to event loop between chunks
  await setImmediate();
}
```

The key to good code comments is that they are tools for communication, not just documentation. They should make your code more approachable and maintainable by reducing the mental effort required to understand it. In Node.js development, where asynchronous patterns and complex data flows are the norm, well-placed comments can be the difference between code that's maintainable and code that becomes technical debt.
