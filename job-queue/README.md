# Job Queue

The Job Queue module provides a robust, file-backed asynchronous job processing system with support for deferred execution, concurrency control, and persistent storage. It's designed for handling background tasks, scheduled operations, and long-running processes in web applications.

## Architecture Overview

The job queue follows a layered architecture with clear separation of concerns:

```
JobQueue (High-Level API)
    ↓
JobQueueEngine (Core Processing)
    ↓
Job (Individual Work Unit)
    ↓
File System (Persistence)
```

## Core Components

### JobQueue
The main high-level API that provides a simple interface for job management. Wraps the JobQueueEngine and provides event-driven job processing.

**Key Features:**
- Simple job scheduling and management
- Event-driven architecture (inherits from EventEmitter)
- Job handler registration
- Safe disposal and resource cleanup
- Support for queuing jobs before startup

**Usage:**
```javascript
import JobQueue from './job-queue.js';

const queue = new JobQueue({ 
    directory: '/path/to/jobs', 
    maxConcurrency: 2 
});

// Register job handlers
queue.registerJobHandler('sendEmail', async (params) => {
    // Email sending logic
    await sendEmail(params.to, params.subject, params.body);
});

// Schedule jobs
await queue.scheduleJob({
    methodName: 'sendEmail',
    params: { to: 'user@example.com', subject: 'Hello', body: 'Welcome!' },
    waitTime: 5000 // Run in 5 seconds
});

// Start processing
queue.start();

// Listen for events
queue.on('error', (error) => console.error('Job error:', error));
```

### JobQueueEngine
The core processing engine that handles job execution, concurrency control, and file persistence.

**Key Features:**
- File-backed job persistence
- Concurrency limiting
- Deferred execution scheduling
- Job state management
- Safe concurrent file operations

**Usage:**
```javascript
import JobQueueEngine from './job-queue-engine.js';

const engine = new JobQueueEngine({
    directory: '/path/to/jobs',
    maxConcurrency: 3,
    eventListener: (eventName, event) => {
        console.log(`${eventName}:`, event);
    }
});

// Register handlers
engine.registerJobHandler('processData', async (params) => {
    // Data processing logic
});

// Load existing jobs and start processing
await engine.load();
await engine.startNextJob();
```

### Job
Represents a single unit of work with state management and persistence capabilities.

**Key Features:**
- Unique ID generation
- State tracking (NOT_STARTED, IN_PROGRESS, COMPLETED, FAILED)
- Deferred execution support
- Safe serialization for storage
- Error handling and reporting

**Usage:**
```javascript
import Job from './job.js';

// Create job from specification
const job = Job.fromSpec({
    methodName: 'processOrder',
    params: { orderId: '12345', userId: 'user123' },
    waitTime: 10000 // Run in 10 seconds
});

// Check job state
console.log(job.state); // 'NOT_STARTED'
console.log(job.isReady()); // false (due to waitTime)

// Get job information
console.log(job.id); // Unique job ID
console.log(job.executionDateString); // ISO string
console.log(job.key); // 'processOrder__2024-01-01T12-00-00-000Z-1234-1'
```

## Job States

Jobs progress through the following states:

1. **NOT_STARTED**: Job is queued but not yet executed
2. **IN_PROGRESS**: Job is currently being executed
3. **COMPLETED**: Job has finished successfully
4. **FAILED**: Job has failed with an error

## Job Scheduling

### Immediate Execution
```javascript
await queue.scheduleJob({
    methodName: 'sendNotification',
    params: { userId: '123', message: 'Hello!' }
});
```

### Deferred Execution
```javascript
// Using waitTime (milliseconds)
await queue.scheduleJob({
    methodName: 'sendReminder',
    params: { userId: '123' },
    waitTime: 24 * 60 * 60 * 1000 // 24 hours
});

// Using executionDate
await queue.scheduleJob({
    methodName: 'sendReport',
    params: { reportType: 'monthly' },
    executionDate: new Date('2024-02-01T09:00:00Z').getTime()
});
```

## Job Handlers

Job handlers are async functions that receive job parameters and perform the actual work.

### Simple Handler
```javascript
queue.registerJobHandler('sendEmail', async (params) => {
    const { to, subject, body } = params;
    await emailService.send(to, subject, body);
});
```

### Handler with Array Parameters
```javascript
queue.registerJobHandler('processBatch', async (...items) => {
    for (const item of items) {
        await processItem(item);
    }
});

// Schedule with array parameters
await queue.scheduleJob({
    methodName: 'processBatch',
    params: ['item1', 'item2', 'item3']
});
```

### Error Handling in Handlers
```javascript
queue.registerJobHandler('riskyOperation', async (params) => {
    try {
        await performRiskyOperation(params);
    } catch (error) {
        // Log error but don't re-throw to mark job as failed
        console.error('Operation failed:', error);
        throw error; // Re-throw to mark job as failed
    }
});
```

## Configuration Options

### JobQueue Options
```javascript
const queue = new JobQueue({
    directory: '/path/to/jobs',        // Required: Job storage directory
    maxConcurrency: 5,                 // Optional: Max concurrent jobs (default: 1)
    engine: customEngine               // Optional: Custom engine instance
});
```

### JobQueueEngine Options
```javascript
const engine = new JobQueueEngine({
    directory: '/path/to/jobs',        // Required: Job storage directory
    maxConcurrency: 3,                 // Optional: Max concurrent jobs
    lockingQueue: customLockingQueue,  // Optional: Custom locking queue
    eventListener: (event, data) => {} // Optional: Event listener
});
```

## Events

The JobQueue emits several event types for monitoring and debugging:

### Error Events
```javascript
queue.on('error', (error) => {
    console.error('Job queue error:', error.message, error.cause);
});
```

### Debug Events (from engine)
```javascript
queue.on('debug', (event) => {
    if (event.message === 'starting job') {
        console.log('Starting job:', event.info.job);
    } else if (event.message === 'completed job') {
        console.log('Completed job:', event.info.job);
    }
});
```

## File Storage

Jobs are persisted as JSON files in the specified directory:

```
/jobs/
├── sendEmail__2024-01-01T12-00-00-000Z-1234-1.json
├── processOrder__2024-01-01T13-00-00-000Z-5678-2.json
└── sendReport__2024-01-01T14-00-00-000Z-9012-3.json
```

### Job File Format
```json
{
    "id": "2024-01-01T12-00-00-000Z-1234-1",
    "methodName": "sendEmail",
    "executionDate": 1704110400000,
    "state": "NOT_STARTED",
    "params": {
        "to": "user@example.com",
        "subject": "Hello",
        "body": "Welcome!"
    }
}
```

## Concurrency Control

The job queue supports configurable concurrency limits:

```javascript
// Allow up to 3 jobs to run simultaneously
const queue = new JobQueue({ 
    directory: '/jobs', 
    maxConcurrency: 3 
});

// Check current concurrency
console.log(engine.hasReachedMaxConcurrency); // false

// Dynamically adjust concurrency
engine.setMaxConcurrency(5);
```

## Job Management

### Remove Jobs by Method
```javascript
// Remove all jobs of a specific type
await queue.removeJobsByMethodName('sendEmail');
```

### Get All Jobs
```javascript
const allJobs = await engine.getAllJobs();
console.log(`Total jobs: ${allJobs.length}`);

// Filter by state
const pendingJobs = allJobs.filter(job => job.state === 'NOT_STARTED');
const failedJobs = allJobs.filter(job => job.state === 'FAILED');
```

### Job Cleanup
```javascript
// Dispose queue (stops processing and cleans up resources)
queue.dispose();
```

## Best Practices

### Job Handler Design
1. **Idempotency**: Design handlers to be safe if executed multiple times
2. **Error Handling**: Always handle errors appropriately
3. **Resource Management**: Clean up resources in handlers
4. **Logging**: Include appropriate logging for debugging

### Performance Considerations
1. **Concurrency Limits**: Set appropriate limits based on system resources
2. **Job Size**: Keep individual jobs focused and not too large
3. **File I/O**: The queue uses file I/O for persistence, consider disk performance
4. **Memory Usage**: Large job parameters consume memory

### Reliability
1. **Job Persistence**: Jobs survive application restarts
2. **Error Recovery**: Failed jobs are marked and logged
3. **Concurrent Safety**: File operations are protected with locking
4. **Graceful Shutdown**: Use dispose() for clean shutdown

## Real-World Examples

### Email Queue System
```javascript
const emailQueue = new JobQueue({ 
    directory: '/email-jobs', 
    maxConcurrency: 2 
});

emailQueue.registerJobHandler('sendWelcomeEmail', async (params) => {
    const { userId, email } = params;
    await emailService.sendWelcomeEmail(email);
    await userService.markEmailSent(userId);
});

emailQueue.registerJobHandler('sendPasswordReset', async (params) => {
    const { email, resetToken } = params;
    await emailService.sendPasswordReset(email, resetToken);
});

// Schedule welcome email
await emailQueue.scheduleJob({
    methodName: 'sendWelcomeEmail',
    params: { userId: '123', email: 'user@example.com' }
});

emailQueue.start();
```

### Data Processing Pipeline
```javascript
const processingQueue = new JobQueue({ 
    directory: '/processing-jobs', 
    maxConcurrency: 3 
});

processingQueue.registerJobHandler('processUpload', async (params) => {
    const { fileId, userId } = params;
    
    // Process the uploaded file
    const result = await fileProcessor.process(fileId);
    
    // Schedule notification job
    await processingQueue.scheduleJob({
        methodName: 'notifyCompletion',
        params: { userId, fileId, result },
        waitTime: 1000 // Small delay
    });
});

processingQueue.registerJobHandler('notifyCompletion', async (params) => {
    const { userId, fileId, result } = params;
    await notificationService.notify(userId, `File ${fileId} processed successfully`);
});

processingQueue.start();
```

### Scheduled Maintenance
```javascript
const maintenanceQueue = new JobQueue({ 
    directory: '/maintenance-jobs', 
    maxConcurrency: 1 
});

maintenanceQueue.registerJobHandler('cleanupOldFiles', async () => {
    await fileService.deleteOldFiles();
});

maintenanceQueue.registerJobHandler('updateStatistics', async () => {
    await statsService.updateDailyStats();
});

// Schedule daily cleanup at 2 AM
const tomorrow2AM = new Date();
tomorrow2AM.setDate(tomorrow2AM.getDate() + 1);
tomorrow2AM.setHours(2, 0, 0, 0);

await maintenanceQueue.scheduleJob({
    methodName: 'cleanupOldFiles',
    executionDate: tomorrow2AM.getTime()
});

maintenanceQueue.start();
```

## Error Handling

### Job Failure Handling
```javascript
queue.on('error', (error) => {
    if (error.info?.job) {
        const job = error.info.job;
        console.error(`Job ${job.id} failed:`, error.cause);
        
        // Optionally retry failed jobs
        if (job.state === 'FAILED' && shouldRetry(job)) {
            retryJob(job);
        }
    }
});
```

### Handler Error Recovery
```javascript
queue.registerJobHandler('criticalOperation', async (params) => {
    try {
        await performCriticalOperation(params);
    } catch (error) {
        // Log detailed error information
        console.error('Critical operation failed:', {
            jobId: params.jobId,
            error: error.message,
            stack: error.stack
        });
        
        // Re-throw to mark job as failed
        throw error;
    }
});
```

The Job Queue module provides a robust foundation for building reliable background job processing systems with persistence, concurrency control, and comprehensive error handling. 