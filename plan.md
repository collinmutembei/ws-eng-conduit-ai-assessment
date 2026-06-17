# Implementation Plan

We are implementing a "Co-Authors" feature that allows multiple users to edit the same article. To manage scope and risk, we will build this in two phases: first satisfying the BASIC requirements (schema, authorization, simple UI), and then implementing the ADVANCED requirements (multi-select, pessimistic locking, and error states).

## Plan

### Phase 1: BASIC Implementation (Foundation & Authorization)
1. **Database Schema (NestJS / TypeORM or MikroORM):**
   * Update the `Article` entity to add a Many-To-Many relationship called `coAuthors` targeting the `User` entity. 
   * Generate and apply the database migration.
2. **DTOs & API Contracts (NestJS):**
   * Update `CreateArticleDto` and `UpdateArticleDto` to accept a `coAuthors` array (strings representing emails for the basic tier).
3. **Authorization Logic (`ArticleService.ts`):**
   * Currently, the update/delete methods likely check `article.author.id === currentUser.id`. Update this logic: allow the edit if the user is the original author OR if their ID/email exists in the `article.coAuthors` array.
   * *Constraint Check:* The requirement states "last version saved is used" for basic. By not implementing version tracking (Optimistic Locking) yet, standard database overwrites naturally handle this.
4. **Frontend UI - Basic (React):**
   * In the React article editor component, add a simple text input field for "Co-Authors".
   * Parse the comma-separated emails and include them in the article creation/update payload via the API agent (`agent.ts`).

### Phase 2: ADVANCED Implementation (Locking & Dropdown UX)
1. **User Fetching Endpoint (NestJS):**
   * Create a lightweight `GET /users` endpoint (or extend the existing profile endpoint) to return a list of all current users for the frontend dropdown. *Security constraint: Ensure passwords and raw tokens are excluded.*
2. **Locking Metadata (`Article` Entity):**
   * Add three nullable fields to the `Article` entity: `lockedById` (relation to User), `lockedAt` (timestamp), and `lastPingAt` (timestamp). Run migrations.
3. **Lock Lifecycle Endpoints (NestJS):**
   * `POST /articles/:slug/lock`: Acquires the lock. Rejects with `409 Conflict` if `lockedById` is another user AND `lastPingAt` is within the last 5 minutes. Updates the fields if successful.
   * `POST /articles/:slug/ping`: Updates `lastPingAt` to `now()`. Rejects if the user doesn't hold the lock.
   * `DELETE /articles/:slug/lock`: Clears the lock fields.
   * **Update Guard:** Modify the existing PUT/update article endpoint to ensure the user saving the article actually holds the valid lock.
4. **Frontend UI - Advanced (React):**
   * **Dropdown:** Replace the basic comma-separated input with a multi-select dropdown (e.g., `react-select`) populated by the new `/users` endpoint.
   * **Lock Acquisition (`useEffect`):** When the editor mounts for an existing article, immediately call the `/lock` API. 
     * *Success:* Set up a `setInterval` to call the `/ping` endpoint every 60 seconds.
     * *Failure (409):* Set an `isLocked` state to true. Disable the form and show the required banner: "This article is currently locked for editing by another user."
   * **Lock Release:** In the `useEffect` cleanup return function, clear the interval and call the `/unlock` API (handles navigating away). Also call `/unlock` on successful form save.
   * **Lost Lock State:** If a `ping` or `save` fails because the lock was lost (e.g., internet dropped and 5 mins passed), catch the error and show an alert: "You have lost the editing lock."

## Decisions

* **Decision:** Implement Pessimistic Locking with a Time-To-Live (TTL) Heartbeat.
  * **Alternative:** Optimistic locking via version numbers (ETags).
  * **Alternative:** WebSockets for real-time presence.
  * **Rationale:** The ADVANCED user story explicitly states the article "becomes locked" when opened and blocks other users from trying to edit. Optimistic locking only fails at the *save* step, which violates the requirement. WebSockets would handle real-time unlocks beautifully, but introduce heavy infrastructure requirements (connection management, sticky sessions). HTTP polling with a TTL heartbeat solves the problem with the least new machinery, natively handling edge cases like browser crashes (the lock just expires after 5 minutes of missed pings).

* **Decision:** Track lock state directly on the `Article` database table.
  * **Alternative:** Use an external cache like Redis.
  * **Rationale:** Adding Redis violates the unstated constraint of keeping the stack simple and incremental. Because the lock dictates whether the primary `UPDATE` query on the article is allowed, keeping `lockedById` directly on the `Article` record ensures transactional integrity.

* **Decision:** Tie the lock heartbeat to React's component lifecycle (`useEffect`).
  * **Alternative:** Handle locking in global state (Redux/Zustand) or a background service worker.
  * **Rationale:** By managing the `setInterval` ping inside the Editor component's `useEffect`, we guarantee that the cleanup function fires exactly when the user unmounts the component (navigates away). This keeps the frontend architecture strictly localized to the feature without polluting global state.

## Notes

* **Original Author Display:** As per scope notes, we must ensure that adding `coAuthors` does not break the standard "view article" page. We will not alter the main author display logic; co-authors are strictly an access-control mechanism for editing.
* **Optional Story Prep:** This architecture perfectly sets up the optional story (Original author forced unlock). A "Force Unlock" button will simply invoke an endpoint that overrides `lockedById` without checking the 5-minute rule. When the displaced co-author's next heartbeat ping fires, it will return a `409 Conflict`, which the frontend can catch to trigger the required popup.