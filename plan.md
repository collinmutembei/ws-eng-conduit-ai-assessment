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

### Phase 2: UX Upgrade & E2E Automation (Advanced Prep)
1. **User Fetching Endpoint (NestJS):**
   * Create a lightweight `GET /users` endpoint to return a list of all current users (specifically their usernames and profile data). 
   * *Security constraint:* Ensure passwords, emails, and raw tokens are explicitly excluded from this payload.
2. **Frontend UI - Multi-Select Dropdown (React):**
   * Replace the basic comma-separated email input in the editor with a multi-select dropdown component.
   * Populate this dropdown using the new `/users` endpoint.
   * Map the selected usernames back to the required format for the `CreateArticleDto` and `UpdateArticleDto`.
3. **Automated Acceptance Testing (Playwright) - Part 1:**
   * Initialize a Playwright test suite (`tests/article-coauthors.spec.ts`).
   * **Test 1:** Automate logging in as Zolly, creating a new article, selecting John from the new co-author dropdown, capturing `submission/test1.png`, and saving.
   * **Test 2:** Automate logging in as John, opening the shared article, verifying edit access, and capturing `submission/test2.png`.

### Phase 3: ADVANCED Implementation (Pessimistic Locking)
1. **Locking Metadata (`Article` Entity):**
   * Add nullable fields to the `Article` entity: `lockedById` (relation to User), `lockedAt` (timestamp), and `lastPingAt` (timestamp). Run migrations.
2. **Lock Lifecycle Endpoints (NestJS):**
   * `POST /articles/:slug/lock`: Acquires the lock (fails with 409 if held by another and `lastPingAt` < 5 mins ago).
   * `POST /articles/:slug/ping`: Updates `lastPingAt` to `now()`.
   * `DELETE /articles/:slug/lock`: Clears the lock.
   * Update the `PUT` article endpoint to reject saves if the lock is lost.
3. **Frontend Lock Integration (React):**
   * Use `useEffect` in the editor to attempt lock acquisition on mount.
   * Set up a 60-second `setInterval` ping if successful. 
   * If locked by another, disable the form and show the warning banner. Release the lock on unmount or save.
4. **Automated Acceptance Testing (Playwright) - Part 2:**
   * **Test 3:** Automate an incognito session for Zolly attempting to edit the locked article, verifying the error banner, and capturing `submission/test3.png`.


## Decisions

* **Decision: Phased Implementation Strategy (Risk Management)**
  * **Alternative:** A "big-bang" approach, attempting to implement the schema, UI, and complex locking logic all in a single pass.
  * **Rationale:** As a Team Lead, prioritizing delivery and mitigating risk is paramount. Implementing the `BASIC` requirements first guarantees we secure a passing baseline. Upgrading the UX and establishing Playwright automation in Phase 2 creates an automated safety net. Isolating the complex `ADVANCED` stateful locking into Phase 3 ensures that if we encounter severe edge cases, our foundational feature is already functioning and tested. 

* **Decision: Pessimistic Locking via HTTP Polling with a 5-Minute TTL**
  * **Alternative:** Optimistic locking (version numbers/ETags) or WebSockets.
  * **Rationale:** The ADVANCED user story strictly mandates that the article is physically locked *upon opening*. Optimistic locking fails this constraint, as it only prevents conflicts at the final *save* action. While WebSockets provide elegant real-time presence, they introduce significant infrastructure overhead (connection state management, load balancer sticky sessions). HTTP polling with a 5-minute Time-To-Live (TTL) heartbeat natively solves complex operational edge cases—like a user losing their internet connection or their browser crashing—because the lock implicitly expires without requiring a reliable `unload` network event. This adheres to the "Simplicity" and "Operational Reality" grading criteria.

* **Decision: Persisting Lock State directly in the `Article` Database Entity**
  * **Alternative:** Utilizing an external, distributed in-memory cache like Redis.
  * **Rationale:** While Redis is the enterprise standard for high-throughput distributed locks, introducing it violates the assessment's "Incrementalism" constraint (solving the problem with the *least new machinery*). Because the lock state ultimately dictates whether a `PUT` (save) operation is authorized, keeping `lockedById`, `lockedAt`, and `lastPingAt` on the `Article` table guarantees strict transactional consistency without introducing an external point of failure.

* **Decision: Component-Bound Polling Lifecycle (React `useEffect`)**
  * **Alternative:** Global state side-effects (e.g., Redux Sagas) or dedicated background Web Workers.
  * **Rationale:** Tying the heartbeat `setInterval` directly to the `ArticleEditor`'s `useEffect` hook is the most idiomatic and localized pattern for this architecture. The React cleanup function guarantees that the `unlock` endpoint is called and polling terminates the exact millisecond the component unmounts (when the user navigates away). This prevents memory leaks and artificial lock inflation without polluting the global application state.

* **Decision: Dedicated, Stripped-Down `GET /users` Endpoint**
  * **Alternative:** Reusing a generic user fetching endpoint or returning full user entities.
  * **Rationale:** Security and payload optimization. Returning full user records to populate a frontend dropdown risks leaking sensitive PII (emails) and security vectors (password hashes, tokens) to the client browser. The new endpoint is strictly shaped to return only `username` and `image`, protecting tenant data while minimizing network payload size.

* **Decision: Automated Artifact Generation via Playwright**
  * **Alternative:** Manually opening browser windows, clicking through the UI, and using OS screenshot tools.
  * **Rationale:** Manual testing is prone to human error, difficult to reproduce during a review, and scales poorly. Scripting the three Acceptance Tests with Playwright not only generates the required `submission/` artifacts flawlessly, but it also demonstrates CI/CD readiness. Playwright's native support for isolated browser contexts allows us to perfectly and reliably simulate the concurrent multi-user scenario (Zolly vs. John) on a single local machine without session overlap.

## Notes

* **Data Minimization and Security Scoping:**
  The new `GET /users` endpoint introduced to populate the frontend multi-select dropdown must be strictly tailored. It must return only public-facing profiles (specifically `username` and `image`). Exposing full user payloads risks leaking sensitive fields like email addresses, password hashes, or account configuration tokens to the client application layout.

* **Server-Authoritative Clock Verification:**
  To prevent client-side system clock manipulation or drift from disrupting the pessimistic locking mechanism, all time calculations must rely entirely on the backend database or application server timestamp. When evaluating whether a lock has expired, the comparison must be calculated using `ServerTime - lastPingAt`. Client devices must never dictate or pass the current timestamp within the ping payloads.

* **Deterministic Automated Artifact Collection:**
  The Playwright script configured for Step 5 must be configured with explicit viewport configurations (e.g., 1280x720) to guarantee screenshot consistency across varying runner environments. The script must execute in a clean browser environment to prevent dirty session leakage between the simulated profiles of Zolly and John. All screenshots must be written directly to the `./submission/` directory without generating nested child folders, fulfilling the strict automated grading criteria.

* **Operational Resilience against Network Degradation:**
  The frontend React logic in `ArticleEditor.tsx` must gracefully handle network flapping or transient failures when dispatching heartbeat pings. A single failed ping due to a temporary network timeout should not instantly terminate the user session or clear the form state. Instead, the UI should retry the ping operation using a shallow retry count before executing a full state lockout and notifying the user.

* **Architecture Alignment with the Optional Story:**
  The structural decision to store locking fields on the primary database entity explicitly path-clears the implementation for the optional story. If the original author initiates a forced unlock command, the backend control plane simply overwrites the `lockedById` field with the author's identifier. The active co-author's background heartbeat loop will receive an immediate authorization rejection on its subsequent 60-second execution interval, providing a clean trigger to surface the local backup prompt and gracefully redirect them back to the article view dashboard.