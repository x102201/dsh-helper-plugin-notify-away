/**
 * Completion-edge, wait-edge, and "are you looking" policy. Pure, so the host
 * tests and the browser half can share one definition of when a toast should
 * fire.
 *
 * Keep `client.js` in lockstep: it inlines the same predicates because the
 * Web UI loads it as a ModuleLoader factory, not as an ESM graph.
 *
 * @module dsh-helper-plugin-notify-away/lib/policy
 */

/** Toast body when a session is stuck waiting and no better copy is available. */
export const WAIT_BODY = 'Waiting for you.';

/** Sidebar-matching copy for the known pending-interaction kinds. */
const WAIT_BODY_BY_KIND = Object.freeze({
  approval: 'Waiting for approval',
  question: 'Waiting for answer',
  'plan-review': 'Plan awaiting review',
});

/**
 * Whether one listed session is a subagent rather than a root conversation.
 *
 * Matches the client SessionSummary shape from dsh-api-session-controller:
 * subagents carry `origin: 'subagent'` and/or a `parentId`.
 *
 * @param {object} summary - one sessions-list row.
 * @returns {boolean} true when this row is a child agent.
 */
export function isSubagent(summary) {
  return summary.origin === 'subagent' || summary.parentId !== undefined;
}

/**
 * Whether one completion or wait should raise a system notification.
 *
 * Cursor's rule: stay silent only while the user is looking at the session
 * that just finished or blocked. Notify when they are away (other window /
 * hidden tab) or when a different session needs them.
 *
 * @param {object} input - the gate inputs.
 * @param {string} input.sessionId - the session that just finished running.
 * @param {string | undefined} input.current - the currently selected session id.
 * @param {boolean} input.away - the page is hidden or the window lost focus.
 * @param {boolean} [input.onlyWhenAway=true] - apply the looking-at-it gate.
 * @returns {boolean} true when a toast should fire.
 */
export function shouldNotify({ sessionId, current, away, onlyWhenAway = true }) {
  if (!onlyWhenAway) return true;
  return away || current !== sessionId;
}

/**
 * Whether this session's running→idle edge is eligible to notify.
 *
 * @param {object} summary - the finishing session.
 * @param {boolean} [includeSubagents=false] - also notify for child agents.
 * @returns {boolean} true when this row may produce a toast.
 */
export function shouldTrack(summary, includeSubagents = false) {
  if (includeSubagents) return true;
  return !isSubagent(summary);
}

/**
 * Watch a sessions-list snapshot and notify on each running→idle edge.
 *
 * The first observation only records each session's running bit, so a session
 * already idle at load never notifies, while one that appears running and
 * later idles does.
 *
 * @param {object} list - `{ getSnapshot(), subscribe(listener) }`.
 * @param {(summary: object) => void} notify - completion callback.
 * @param {() => boolean} isAway - whether the user is away from the page.
 * @param {object} [options] - policy switches.
 * @param {boolean} [options.onlyWhenAway=true] - looking-at-it gate.
 * @param {boolean} [options.includeSubagents=false] - subagent completions.
 * @returns {() => void} disposer that unsubscribes and drops the running-bit map.
 */
export function watchCompletions(list, notify, isAway, options = {}) {
  const onlyWhenAway = options.onlyWhenAway !== false;
  const includeSubagents = options.includeSubagents === true;
  const prevRunning = new Map();

  const onChange = () => {
    const snapshot = list.getSnapshot();
    const byId = snapshot.byId ?? {};
    const current = snapshot.current;
    const seen = new Set();
    for (const summary of Object.values(byId)) {
      seen.add(summary.id);
      const prev = prevRunning.get(summary.id);
      if (prev === undefined) {
        prevRunning.set(summary.id, summary.running);
        continue;
      }
      if (
        prev
        && !summary.running
        && shouldTrack(summary, includeSubagents)
        && shouldNotify({ sessionId: summary.id, current, away: isAway(), onlyWhenAway })
      ) {
        notify(summary);
      }
      prevRunning.set(summary.id, summary.running);
    }
    for (const id of prevRunning.keys()) {
      if (!seen.has(id)) prevRunning.delete(id);
    }
  };

  onChange();
  return list.subscribe(onChange);
}

/**
 * Toast body for one pending interaction that has blocked the turn.
 *
 * Prefer the asker's own reason or first question (that is what the card
 * shows). Fall back to the sidebar status labels for the known kinds, then
 * a generic "waiting" line so a future kind still toasts.
 *
 * @param {object | undefined} interaction - one `pendingInteractions` value.
 * @returns {string} toast body copy.
 */
export function bodyForWait(interaction) {
  if (interaction && typeof interaction.reason === 'string') {
    const reason = interaction.reason.trim();
    if (reason) return reason;
  }
  const questions = interaction && Array.isArray(interaction.questions) ? interaction.questions : [];
  if (questions.length > 0) {
    const text = typeof questions[0]?.question === 'string' ? questions[0].question.trim() : '';
    if (text) return text;
  }
  const kind = interaction && typeof interaction.kind === 'string' ? interaction.kind : '';
  return WAIT_BODY_BY_KIND[kind] ?? WAIT_BODY;
}

/**
 * Watch pending UI interactions and notify when a session newly waits on the
 * user (approval, question, plan review, or any later kind).
 *
 * The snapshot is the same `uiSession.pendingInteractions` map the sidebar
 * reads. A turn that needs a human is still `running`, so {@link watchCompletions}
 * stays silent until the wait clears and the session later goes idle.
 *
 * The first observation only records each session's pending key, so a wait
 * already on screen at load never toasts. A replacement request uses a new
 * key and is a fresh edge.
 *
 * @param {object} list - `{ getSnapshot(), subscribe(listener) }` sessions list.
 * @param {object} pendingStore - `{ getSnapshot(): Map, subscribe(listener) }`.
 * @param {(event: { summary: object, interaction: object }) => void} notify - wait callback.
 * @param {() => boolean} isAway - whether the user is away from the page.
 * @param {object} [options] - policy switches (same as {@link watchCompletions}).
 * @param {boolean} [options.onlyWhenAway=true] - looking-at-it gate.
 * @param {boolean} [options.includeSubagents=false] - subagent waits.
 * @returns {() => void} disposer that unsubscribes and drops the pending-key map.
 */
export function watchPending(list, pendingStore, notify, isAway, options = {}) {
  const onlyWhenAway = options.onlyWhenAway !== false;
  const includeSubagents = options.includeSubagents === true;
  const prevKeys = new Map();

  const onChange = () => {
    const snapshot = list.getSnapshot();
    const byId = snapshot.byId ?? {};
    const current = snapshot.current;
    const pending = pendingStore.getSnapshot() ?? new Map();
    const ids = new Set([...Object.keys(byId), ...prevKeys.keys()]);
    for (const id of pending.keys()) ids.add(id);

    for (const id of ids) {
      const summary = byId[id];
      if (summary === undefined) {
        prevKeys.delete(id);
        continue;
      }
      const interaction = pending.get(id);
      const nextKey = interaction && typeof interaction.key === 'string' ? interaction.key : undefined;
      if (!prevKeys.has(id)) {
        prevKeys.set(id, nextKey);
        continue;
      }
      const prevKey = prevKeys.get(id);
      if (
        nextKey !== undefined
        && nextKey !== prevKey
        && shouldTrack(summary, includeSubagents)
        && shouldNotify({ sessionId: summary.id, current, away: isAway(), onlyWhenAway })
      ) {
        notify({ summary, interaction });
      }
      prevKeys.set(id, nextKey);
    }
  };

  onChange();
  const stopList = list.subscribe(onChange);
  const stopPending = pendingStore.subscribe(onChange);
  return () => {
    stopList();
    stopPending();
    prevKeys.clear();
  };
}

/**
 * Page-level "away" predicate used by the browser half.
 *
 * `appFocused` is the helper-injected bit (`window.__dshHelperAppFocused`):
 * true while any dsh-helper window is the OS foreground, false once the user
 * has switched to another app. WebView2's `document.hasFocus()` often stays
 * true across Alt+Tab, so the native flag is the authority when present.
 *
 * @param {{ visibilityState?: string, hasFocus?: () => boolean, appFocused?: boolean }} doc
 * @returns {boolean} true when the tab is hidden or the window is unfocused.
 */
export function isDocumentAway(doc) {
  if (doc.visibilityState === 'hidden') return true;
  if (doc.appFocused === false) return true;
  if (doc.appFocused === true) return false;
  if (typeof doc.hasFocus === 'function' && !doc.hasFocus()) return true;
  return false;
}
