---
name: inline-code-comments
description: Guidelines for writing effective inline comments in JavaScript source code. Apply this skill when writing, refactoring, or reviewing JavaScript code.
---

# Inline code comment guidelines
Here are our core guidelines for inline code comments:

## Explain the "Why," Not Just the "What"
Focus on documenting why some code exists, and why it is doing what it does rather than what it is doing. This is especially true when the code does something that seems counterintuitive or requires domain knowledge:

```javascript
// Increment DB counter BEFORE processing to ensure we don't
// get stuck on the same database if we hit the time limit
currentDb = (currentDb + 1) % totalDatabases;
const db = databases[currentDb];
await processExpiredKeys(db);
```

## Avoid Trivial Comments
Don't state what's obvious from the code:

```javascript
// Bad
user.name = 'John'; // Set the user name to John

// Good
user.name = sanitizeInput(rawName); // Remove potential XSS vectors
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
  const finalAmount = order.total + taxAmount + calculateFee(paymentMethod, order.total);

  // Process payment and update order status
  const transaction = await chargePayment(paymentMethod, finalAmount);
  await updateOrderStatus(order.id, 'paid', transaction.id);

  return transaction;
}
```

## Document State Transitions and Side Effects
Particularly important in Node.js applications with complex state management:

```javascript
// After this call, the connection state changes to 'authenticating'
// and subsequent messages will be queued until auth completes
await connection.startAuthentication(credentials);

// sendCommand will queue rather than send directly while authenticating
const result = await sendCommand('GET_STATUS');
```

## Use "Teacher Comments" for Domain Knowledge
When your code involves concepts that might be outside typical JavaScript/Node.js knowledge:

```javascript
// JWT exp claim uses NumericDate format (seconds since epoch)
// JavaScript Date.now() returns milliseconds, so we divide by 1000
const expiry = Math.floor(Date.now() / 1000) + (60 * 60 * 24); // 24 hours
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

## Flag Coordinated Change Points
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

**Priority order:** Prefer "why" comments over "what" comments. When both are obvious, don't comment at all.
