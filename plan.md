# Implementation Plan

## Plan

1.  **Database & Domain Modeling (Backend):**
    * Update the `Article` entity to support a Many-To-Many relationship with the `User` entity for `coAuthors`.
    * Add lock-tracking metadata fields directly to the `Article` entity: `lockedById` (relation to User), `lockedAt` (timestamp), and `lastPingAt` (timestamp).
    * Update ORM database migrations/schema to reflect the new entity structure.
2.  **API Contracts & Endpoints (Backend):**
    * Modify `CreateArticleDto` and `UpdateArticleDto` to accept an array of user IDs or usernames representing `coAuthors`.
    * Create dedicated endpoints for lock lifecycle management:
        * `POST /articles/:slug/lock` (Acquire)
        * `DELETE /articles/:slug/lock` (Release)
        * `POST /articles/:slug/ping` (Keep-alive)
    * Create a `GET /users` endpoint in the User Controller to return a lightweight list of users for the frontend selection dropdown.
3.  **Business Logic & Authorization (Backend):**
    * Update the `ArticleService` authorization logic so that write operations (edit, delete) are permitted for both the original author and any user in the `coAuthors` array.
    * Implement locking logic: When an update request is received, verify that the current user holds an active, unexpired lock (`lastPingAt` within the last 5 minutes). Reject the request with a `409 Conflict` if the lock is invalid, expired, or held by another user.
4.  **Frontend Implementation (React):**
    * **Data Layer:** Update the frontend `Article` interface to include `coAuthors` and lock metadata. Extend the API client (e.g., `agent.ts`) with methods for locking, pinging, and fetching users.
    * **Create/Edit UI:** Implement a multi-select dropdown in `ArticleEditor.tsx` to search and select co-authors from the `GET /users` list.
    * **Lock Acquisition & Heartbeat:** In `ArticleEditor.tsx`, use a `useEffect` hook to attempt lock acquisition on mount. If successful, start a `setInterval` to ping the backend every 60 seconds. If rejected (409 Conflict), set an `isLocked` state to disable the form and display the required error banner.
    * **Lock Release:** Utilize the `useEffect` cleanup function to clear the interval and call the unlock endpoint when the component unmounts (user navigates away) or saves successfully.
5.  **Automated Acceptance Testing (Playwright):**
    * Initialize a Playwright script (`tests/article-locking.spec.ts`) to automate the requested manual tests and capture the required screenshots directly to the `./submission/` folder.
    * **Test 1 Context:** Automate logging in as Zolly, creating an article, adding John as a co-author, capturing `test1.png`, and saving.
    * **Test 2 Context:** Automate logging in as John, opening the article, capturing `test2.png` (verifying edit capability).
    * **Test 3 Context:** Automate opening a second browser context (incognito) as Zolly, attempting to edit the currently locked article, and capturing `test3.png` (verifying the "ADVANCED" error message).

## Decisions

* **Decision:** Implement Pessimistic Locking with a Time-To-Live (TTL) Heartbeat.
    * **Alternative:** Optimistic locking (version numbers/ETags where the last save overwrites previous changes).
    * **Alternative:** WebSockets for real-time presence.
    * **Rationale:** The "ADVANCED" requirements demand that the article is physically locked upon opening. WebSockets introduce unnecessary infrastructure overhead for a feature easily handled by standard HTTP polling. Pessimistic locking via HTTP endpoints with a TTL "ping" natively handles edge cases like browser crashes or dropped connections, as the lock implicitly expires after 5 minutes of missed pings.

* **Decision:** Embed lock state directly within the `Article` database entity.
    * **Alternative:** Use an in-memory cache like Redis.
    * **Rationale:** Introducing a new infrastructure dependency violates the assessment's expectation of incrementalism. Keeping the `lockedById`, `lockedAt`, and `lastPingAt` fields on the `Article` table ensures transactional consistency when the article is eventually saved, without requiring external machinery.

* **Decision:** React `useEffect` + `setInterval` for the Frontend Heartbeat.
    * **Alternative:** A global state manager side-effect (Redux Saga / Thunk).
    * **Rationale:** Tying the heartbeat strictly to the component lifecycle via `useEffect` is the most idiomatic React pattern for this scope. The cleanup function guarantees that the ping requests will automatically terminate and the unlock endpoint is called when the user unmounts the editor, preventing orphaned locks.

* **Decision:** Automate Acceptance Screenshots using Playwright.
    * **Alternative:** Manually clicking through the UI to generate the submission screenshots.
    * **Rationale:** Playwright natively supports multiple isolated browser contexts, allowing us to accurately simulate concurrent users (Zolly and John) locally without dealing with session overlap. Scripting the tests ensures we can reliably generate the exact artifacts required for the `submission/` folder with a single command, demonstrating high engineering rigor.

## Notes

* **Security Scope:** The new `GET /users` endpoint must explicitly exclude sensitive data (emails, passwords, tokens) and only return public profiles.
* **Optional Story Readiness:** The architecture explicitly supports the optional story out-of-the-box. A "Force Unlock" action will simply bypass the 5-minute check, overwrite the `lockedById` field, and cause the displaced user's next heartbeat ping to return a `409 Conflict`, triggering the required UI pop-up.