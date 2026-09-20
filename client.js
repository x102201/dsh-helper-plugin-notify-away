/**
 * dsh-helper-plugin-notify-away client bundle (browser half).
 *
 * The Web UI loads client plugins as ModuleLoader factories, not as ESM
 * graphs, so this file inlines the policy from `lib/policy.js` instead of
 * importing it. Keep the two in lockstep: `shouldNotify`, `isSubagent`,
 * `shouldTrack`, `isDocumentAway`, `watchCompletions`.
 *
 * Defaults match `resolveConfig(undefined)` in `lib/config.js`.
 *
 * In dsh-helper's WebView2 panel the toast is
 * `chrome.webview.postMessage(JSON.stringify({ kind: 'notify-away', ... }))`
 * — no Notification permission. Helper also writes
 * `window.__dshHelperAppFocused` from OS foreground tracking, because
 * `document.hasFocus()` in WebView2 often stays true after Alt+Tab.
 * Helper click-back is the `dsh-helper-notify-click` CustomEvent.
 */
window.__ModuleLoader__.load({
  id: 'dsh-helper-plugin-notify-away',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;

    const PLUGIN_NAME = 'dsh-helper-plugin-notify-away';
    const DEFAULT_BODY = 'Task finished.';
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
      if (doc.appFocused === false) return true;
      if (doc.appFocused === true) return false;
      if (typeof doc.hasFocus === 'function' && !doc.hasFocus()) return true;
      return false;
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

    function hasHelperHost() {
      try {
        return typeof window !== 'undefined'
          && typeof window.chrome?.webview?.postMessage === 'function';
      } catch {
        return false;
      }
    }

    function payloadFor(summary) {
      const title = String(summary.displayTitle || summary.id || 'Session').trim();
      return {
        kind: 'notify-away',
        title: title || 'Session',
        body: DEFAULT_BODY,
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

    function postToHelper(summary) {
      try {
        window.chrome.webview.postMessage(JSON.stringify(payloadFor(summary)));
        return true;
      } catch {
        return false;
      }
    }

    function showBrowserNotification(summary, ctx) {
      if (typeof Notification === 'undefined') return;
      const fire = () => {
        const payload = payloadFor(summary);
        const notification = new Notification(payload.title, {
          body: payload.body,
          tag: payload.tag,
        });
        notification.onclick = () => openSession(ctx, summary.id);
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

    function showCompletionNotification(summary, ctx) {
      if (hasHelperHost() && postToHelper(summary)) return;
      showBrowserNotification(summary, ctx);
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
      try {
        if (typeof window.__dshHelperAppFocused === 'boolean') {
          appFocused = window.__dshHelperAppFocused;
        }
      } catch {
        // The helper flag is a plain window property; ignore exotic getters.
      }
      return {
        visibilityState: document.visibilityState,
        hasFocus: () => (typeof document.hasFocus === 'function' ? document.hasFocus() : true),
        appFocused,
      };
    }

    exports.name = PLUGIN_NAME;
    exports.inject = ['sessions'];
    exports.apply = (ctx) => {
      ctx.effect(() => listenHelperClicks(ctx), 'notify-away: helper click');
      ctx.effect(() => requestPermissionOnGesture(), 'notify-away: permission request');
      ctx.effect(
        () => watchCompletions(
          ctx.sessions.list,
          (summary) => showCompletionNotification(summary, ctx),
          () => isDocumentAway(readAwayState()),
          { onlyWhenAway: ONLY_WHEN_AWAY, includeSubagents: INCLUDE_SUBAGENTS },
        ),
        'notify-away: completion watcher',
      );
    };

    return module.exports;
  },
});
