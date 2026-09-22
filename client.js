/**
 * dsh-helper-plugin-notify-away client bundle (browser half).
 *
 * The Web UI loads client plugins as ModuleLoader factories, not as ESM
 * graphs, so this file inlines the policy from `lib/policy.js` instead of
 * importing it. Keep the two in lockstep: `shouldNotify`, `isSubagent`,
 * `shouldTrack`, `isDocumentAway`, `bodyForWait`, `watchCompletions`,
 * `watchPending`.
 *
 * Defaults match `resolveConfig(undefined)` in `lib/config.js`.
 *
 * In dsh-helper's WebView2 panel the toast is
 * `chrome.webview.postMessage(JSON.stringify({ kind: 'notify-away', ... }))`
 * — no Notification permission. Helper writes
 * `window.__dshHelperAppFocused` (process foreground) and
 * `window.__dshHelperPanelVisible` (this instance is the one on screen).
 * WebView2's `document.hasFocus()` / `visibilityState` often stay "looking"
 * after Alt+Tab or after switching to another instance.
 * Helper click-back is the `dsh-helper-notify-click` CustomEvent.
 */
window.__ModuleLoader__.load({
  id: 'dsh-helper-plugin-notify-away',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;

    const PLUGIN_NAME = 'dsh-helper-plugin-notify-away';
    const DEFAULT_BODY = 'Task finished.';
    const WAIT_BODY = 'Waiting for you.';
    const WAIT_BODY_BY_KIND = Object.freeze({
      approval: 'Waiting for approval',
      question: 'Waiting for answer',
      'plan-review': 'Plan awaiting review',
    });
    const TAG_PREFIX = 'notify-away:';
    const ONLY_WHEN_AWAY = true;
    const INCLUDE_SUBAGENTS = false;

    function isSubagent(summary) {
      return summary.origin === 'subagent' || summary.parentId !== undefined;
    }

    function shouldNotify({ sessionId, current, away, onlyWhenAway }) {
      if (!onlyWhenAway) return true;
      return away || current !== sessionId;
    }

    function shouldTrack(summary, includeSubagents) {
      if (includeSubagents) return true;
      return !isSubagent(summary);
    }

    function isDocumentAway(doc) {
      if (doc.visibilityState === 'hidden') return true;
      if (doc.panelVisible === false) return true;
      if (doc.appFocused === false) return true;
      if (doc.appFocused === true) return false;
      if (typeof doc.hasFocus === 'function' && !doc.hasFocus()) return true;
      return false;
    }

    function bodyForWait(interaction) {
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

    function watchCompletions(list, notify, isAway, options) {
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

    function watchPending(list, pendingStore, notify, isAway, options) {
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

    function hasHelperHost() {
      try {
        return typeof window !== 'undefined'
          && typeof window.chrome?.webview?.postMessage === 'function';
      } catch {
        return false;
      }
    }

    function sessionTitle(summary) {
      const title = String(summary.displayTitle || summary.id || 'Session').trim();
      return title || 'Session';
    }

    function payloadFor(summary, body) {
      return {
        kind: 'notify-away',
        title: sessionTitle(summary),
        body,
        sessionId: summary.id,
        tag: TAG_PREFIX + summary.id,
      };
    }

    function openSession(ctx, sessionId) {
      try {
        window.focus();
      } catch {
        // Some browsers refuse window.focus from a notification click.
      }
      if (typeof ctx.sessions?.open === 'function') ctx.sessions.open(sessionId);
    }

    function postToHelper(payload) {
      try {
        window.chrome.webview.postMessage(JSON.stringify(payload));
        return true;
      } catch {
        return false;
      }
    }

    function showBrowserNotification(payload, ctx) {
      if (typeof Notification === 'undefined') return;
      const fire = () => {
        const notification = new Notification(payload.title, {
          body: payload.body,
          tag: payload.tag,
        });
        notification.onclick = () => openSession(ctx, payload.sessionId);
      };
      if (Notification.permission === 'granted') {
        fire();
        return;
      }
      if (Notification.permission === 'denied') return;
      try {
        Notification.requestPermission()
          .then((permission) => {
            if (permission === 'granted') fire();
          })
          .catch(() => {});
      } catch {
        // Some browsers throw when requesting permission outside a user gesture.
      }
    }

    function showNotification(payload, ctx) {
      if (hasHelperHost() && postToHelper(payload)) return;
      showBrowserNotification(payload, ctx);
    }

    function requestPermissionOnGesture() {
      if (hasHelperHost()) return () => {};
      if (typeof Notification === 'undefined' || typeof window === 'undefined') return () => {};
      if (Notification.permission !== 'default') return () => {};
      const request = () => {
        try {
          void Notification.requestPermission().catch(() => {});
        } catch {
          // A later completion still requests once.
        }
        window.removeEventListener('pointerdown', request);
        window.removeEventListener('keydown', request);
      };
      window.addEventListener('pointerdown', request);
      window.addEventListener('keydown', request);
      return () => {
        window.removeEventListener('pointerdown', request);
        window.removeEventListener('keydown', request);
      };
    }

    function listenHelperClicks(ctx) {
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return () => {};
      }
      const onClick = (event) => {
        const sessionId = event && event.detail && typeof event.detail.sessionId === 'string'
          ? event.detail.sessionId.trim()
          : '';
        if (!sessionId) return;
        openSession(ctx, sessionId);
      };
      window.addEventListener('dsh-helper-notify-click', onClick);
      return () => window.removeEventListener('dsh-helper-notify-click', onClick);
    }

    function readAwayState() {
      let appFocused;
      let panelVisible;
      try {
        if (typeof window.__dshHelperAppFocused === 'boolean') {
          appFocused = window.__dshHelperAppFocused;
        }
        if (typeof window.__dshHelperPanelVisible === 'boolean') {
          panelVisible = window.__dshHelperPanelVisible;
        }
      } catch {
        // The helper flags are plain window properties; ignore exotic getters.
      }
      return {
        visibilityState: document.visibilityState,
        hasFocus: () => (typeof document.hasFocus === 'function' ? document.hasFocus() : true),
        appFocused,
        panelVisible,
      };
    }

    function watchOptions() {
      return { onlyWhenAway: ONLY_WHEN_AWAY, includeSubagents: INCLUDE_SUBAGENTS };
    }

    function isAway() {
      return isDocumentAway(readAwayState());
    }

    function attachWaitWatcher(owner) {
      return owner.effect(
        () => {
          const pendingStore = owner.uiSession && owner.uiSession.pendingInteractions;
          if (
            pendingStore === undefined
            || typeof pendingStore.getSnapshot !== 'function'
            || typeof pendingStore.subscribe !== 'function'
          ) {
            return () => {};
          }
          return watchPending(
            owner.sessions.list,
            pendingStore,
            (event) => showNotification(payloadFor(event.summary, bodyForWait(event.interaction)), owner),
            isAway,
            watchOptions(),
          );
        },
        'notify-away: wait watcher',
      );
    }

    exports.name = PLUGIN_NAME;
    // Static inject stays `sessions` so boot matches the previously-working row.
    // `uiSession` is provided later by the session UI package; wait for it via
    // ctx.inject when Cordis offers that, otherwise read it if already present.
    exports.inject = ['sessions'];
    exports.apply = (ctx) => {
      ctx.effect(() => listenHelperClicks(ctx), 'notify-away: helper click');
      ctx.effect(() => requestPermissionOnGesture(), 'notify-away: permission request');
      ctx.effect(
        () => watchCompletions(
          ctx.sessions.list,
          (summary) => showNotification(payloadFor(summary, DEFAULT_BODY), ctx),
          isAway,
          watchOptions(),
        ),
        'notify-away: completion watcher',
      );
      if (typeof ctx.inject === 'function') {
        ctx.inject(['uiSession'], attachWaitWatcher);
      } else {
        attachWaitWatcher(ctx);
      }
    };

    return module.exports;
  },
});
