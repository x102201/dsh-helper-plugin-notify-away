/**
 * dsh-helper-plugin-notify-away client bundle (browser half).
 *
 * The Web UI loads client plugins as ModuleLoader factories, not as ESM
 * graphs, so this file inlines the policy from `lib/policy.js` instead of
 * importing it. Keep the two in lockstep: `shouldNotify`, `isSubagent`,
 * `shouldTrack`, `isDocumentAway`, `watchCompletions`.
 *
 * Defaults match `resolveConfig(undefined)` in `lib/config.js`.
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

    function showCompletionNotification(summary, ctx) {
      if (typeof Notification === 'undefined') return;
      const fire = () => {
        const notification = new Notification(summary.displayTitle, {
          body: DEFAULT_BODY,
          tag: TAG_PREFIX + summary.id,
        });
        notification.onclick = () => {
          try {
            window.focus();
          } catch {
            // Some browsers refuse window.focus from a notification click.
          }
          if (typeof ctx.sessions?.open === 'function') ctx.sessions.open(summary.id);
        };
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

    function requestPermissionOnGesture() {
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

    exports.name = PLUGIN_NAME;
    exports.inject = ['sessions'];
    exports.apply = (ctx) => {
      ctx.effect(() => requestPermissionOnGesture(), 'notify-away: permission request');
      ctx.effect(
        () => watchCompletions(
          ctx.sessions.list,
          (summary) => showCompletionNotification(summary, ctx),
          () => isDocumentAway(document),
          { onlyWhenAway: ONLY_WHEN_AWAY, includeSubagents: INCLUDE_SUBAGENTS },
        ),
        'notify-away: completion watcher',
      );
    };

    return module.exports;
  },
});
