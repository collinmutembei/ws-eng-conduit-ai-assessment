# Implementation Plan

## Plan

1.  **Database & Domain Modeling (Backend):**
    * Update the `Article` entity to support a Many-To-Many relationship with the `User` entity for `coAuthors`.
    * Add lock-tracking metadata fields directly to the `Article` entity: `lockedById` (relation to User), `lockedAt` (timestamp), and `lastPingAt` (timestamp).
    * Update TypeORM/MikroORM database migrations to reflect the new schema.
2.  **API Contracts & DTOs (Backend):**
    * Modify `CreateArticleDto` and `UpdateArticleDto` to accept an array of usernames or emails representing `coAuthors`.
    * Create dedicated endpoints for lock lifecycle management:
        * `POST /articles/:slug/lock` (Acquire)
        * `DELETE /articles/:slug/lock` (Release)
        * `POST /articles/:slug/ping` (Keep-alive)
    * Create an endpoint `GET /users` in the User Controller to return a lightweight list of users for the frontend selection dropdown.
3.  **Business Logic & Authorization (Backend):**
    * Update the `ArticleService` authorization logic so that write operations (edit, delete) are permitted for both the original author and any user in the `coAuthors` array.
    * Implement the locking logic: When an update request is received, verify that the current user holds an active, unexpired lock (`lastPingAt` within the last 5 minutes). Reject the request with a `409 Conflict` if the lock is invalid or held by another user.
4.  **Frontend Services & Data Models (Angular):**
    * Update the frontend `Article` interface to include the new `coAuthors` and lock metadata fields.
    * Extend the frontend `ArticlesService` to consume the new lock, release, and ping endpoints.
    * Extend the `UserService` to consume the new endpoint fetching all available users.
5.  **Frontend UI & UX (Angular - EditorComponent):**
    * **Dropdown:** Implement a multi-select dropdown in the `EditorComponent` template to search and select co-authors.
    * **Lock Acquisition:** On component initialization (`ngOnInit`), if editing an existing article, attempt to acquire the lock. 
        * If successful, start an RxJS interval to ping the backend every 60 seconds.
        * If rejected (locked by someone else), display a clear error banner and disable the form inputs.
    * **Lock Release:** Implement `ngOnDestroy` to clear the ping interval and automatically release the lock when the user navigates away or successfully saves.
6.  **E2E and Unit Testing:**
    * Write backend unit tests for the `ArticleService` to ensure the 5-minute lock expiration and authorization logic are strictly enforced.
    * Manually verify the Acceptance Tests utilizing an incognito window to simulate concurrent editor conflict.

## Decisions

* **Decision:** Implement Pessimistic Locking with a Time-To-Live (TTL) Heartbeat.
    * **Alternative:** Optimistic locking (using version numbers/ETags where the last save overwrites previous changes, as described in the "BASIC" requirement).
    * **Alternative:** WebSockets for real-time presence and lock streaming.
    * **Rationale:** The "ADVANCED" requirements explicitly demand that the article becomes physically locked when opened, preventing others from attempting to edit it simultaneously. WebSockets introduce unnecessary infrastructure overhead (connection state management, load balancer sticky sessions) for a feature that can be handled via standard HTTP polling. Pessimistic locking via HTTP endpoints with a TTL "ping" heartbeat is the most resilient pattern here. It natively handles edge cases like browser crashes or dropped internet connections because the lock will implicitly expire after 5 minutes of no pings, preventing permanently orphaned locks.

* **Decision:** Embed lock state directly within the `Article` database entity.
    * **Alternative:** Use a distributed in-memory cache like Redis to track lock state independently of the primary database.
    * **Rationale:** While Redis is the industry standard for high-throughput distributed locks, introducing a new infrastructure dependency (Redis) violates the assessment's expectation of incrementalism ("solve the problem with the least new machinery"). Since the lock state directly dictates the authorization rules for saving the core entity, keeping the `lockedById`, `lockedAt`, and `lastPingAt` fields on the `Article` table ensures transactional consistency when the article is eventually saved.

* **Decision:** RxJS Polling for the Frontend Heartbeat.
    * **Alternative:** Standard Javascript `setInterval`.
    * **Rationale:** Since the frontend is Angular, leveraging RxJS `interval()` combined with `switchMap` and `takeUntil` (bound to component destruction) is the safest and most idiomatic way to handle the heartbeat. It guarantees that the ping requests will automatically terminate when the user navigates away, preventing memory leaks and rogue background requests that would keep the lock alive artificially.

## Notes

* **Security Scope:** The new `GET /users` endpoint must be implemented carefully. To prevent data leakage, it should only return minimal public information (e.g., `username`, `image`) and explicitly exclude emails, passwords, and tokens.
* **Optional Story Readiness:** The architecture explicitly supports the optional story out-of-the-box. A "Force Unlock" action will simply bypass the current lock check and overwrite the `lockedById` field with the original author's ID, while the existing co-author's next heartbeat ping will return a `409 Conflict`, triggering the required UI pop-up.