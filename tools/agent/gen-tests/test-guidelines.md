
The goal of unit testing is to build confidence. Good unit tests should give you the confidence to refactor fearlessly, knowing that any breaking changes will be caught immediately.

## Test Behavior, Not Implementation
Focus on testing the public interface and observable behaviors of your components, not their internal implementation details. This makes your tests more resilient to refactoring and ensures they actually verify user-facing functionality.

## Test Clarity and Intent
The most important aspect is that tests serve as living documentation. Each test should clearly express *what* the code should do, not just verify that it works. Use descriptive test names that read like specifications: `should_return_empty_list_when_no_items_match_filter` rather than `test_filter`. Someone reading your tests six months later should immediately understand the expected behavior.

## The Arrange, Act, Assert Pattern (AAA)
Structure every test with Arrange, Act, Assert. Set up your test data and dependencies, execute the specific behavior you're testing, then verify the outcome. This creates a consistent, readable flow that makes tests easy to follow and debug.

## Test One Thing at a Time
Each test should verify exactly one behavior or outcome. If you find yourself writing multiple assertions that test different aspects, split them into separate tests. This makes failures more precise and debugging much faster.

## Independence and Isolation
Tests must be completely independent of each other and of external systems. No shared state, no reliance on test execution order, no database calls, no network requests. Use mocks, stubs, and dependency injection to isolate the unit under test. I should be able to run any single test in isolation and get the same result.

## Fast Execution
Unit tests should run in milliseconds, not seconds. If your test suite takes more than a few seconds to run hundreds of tests, something's wrong. Slow tests discourage frequent execution and break the feedback loop that makes TDD effective.

## Comprehensive Edge Case Coverage
Don't just test the happy path. Test boundary conditions, null inputs, empty collections, maximum values, error conditions, and unexpected states. These edge cases are where bugs typically hide.

## Meaningful Test Data
Use test data that makes the test's intent clear. Instead of generic values like `foo` and `bar`, use data that reflects the domain: `validEmailAddress` and `customerWithExpiredAccount`. This makes tests self-documenting and failures more informative.

## Fail Fast and Fail Clear
When a test fails, the error message should immediately tell you what went wrong and why. Good assertion libraries help here, but also structure your tests so failures are unambiguous.

## Maintainability Matters
Treat test code with the same care as production code. Refactor when needed, eliminate duplication thoughtfully, and keep tests readable. Bad test code will eventually become a maintenance burden that slows down development.
