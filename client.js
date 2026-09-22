/**
 * dsh-helper-plugin-notify-away client bundle (browser half).
 *
 * The Web UI loads client plugins as ModuleLoader factories, not as ESM
 * graphs, so this file inlines the policy from `lib/policy.js` instead of
 * importing it. Keep the two in lockstep: `shouldNotify`, `isSubagent`,
 * `shouldTrack`, `isDocumentAway`, `bodyForWait`, `waitEvent`, `isEventEnabled`,
 * `watchCompletions`, `watchPending`.
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
    const PLUGIN_REPO = 'https://github.com/x102201/dsh-helper-plugin-notify-away';
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
    const EVENT_KEYS = ['completion', 'approval', 'question', 'planReview', 'otherWait'];
    const SETTINGS_NAMESPACE = 'notify-away';
    const SETTINGS_LOCALE_NS = 'notify-away';
    const WAIT_EVENT_BY_KIND = Object.freeze({
      approval: 'approval',
      question: 'question',
      'plan-review': 'planReview',
    });

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

    function waitEvent(interaction) {
      const kind = interaction && typeof interaction.kind === 'string' ? interaction.kind : '';
      return WAIT_EVENT_BY_KIND[kind] ?? 'otherWait';
    }

    function isEventEnabled(options, event) {
      return options[event] !== false;
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
            && isEventEnabled(options, 'completion')
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
            && isEventEnabled(options, waitEvent(interaction))
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

    let rowEvents;
    let settingsFlags = {};
    const liveOptions = {
      onlyWhenAway: ONLY_WHEN_AWAY,
      includeSubagents: INCLUDE_SUBAGENTS,
    };
    for (const key of EVENT_KEYS) liveOptions[key] = true;

    function readEventFlags(rowConfig) {
      const flags = {};
      for (const key of EVENT_KEYS) flags[key] = true;
      const overlay = (() => {
        try {
          return window.__dshHelperNotifyAway;
        } catch {
          return undefined;
        }
      })();
      for (const source of [rowConfig, settingsFlags, overlay]) {
        if (!source || typeof source !== 'object') continue;
        for (const key of EVENT_KEYS) {
          if (typeof source[key] === 'boolean') flags[key] = source[key];
        }
      }
      return flags;
    }

    function refreshLiveOptions() {
      liveOptions.onlyWhenAway = ONLY_WHEN_AWAY;
      liveOptions.includeSubagents = INCLUDE_SUBAGENTS;
      const flags = readEventFlags(rowEvents);
      for (const key of EVENT_KEYS) liveOptions[key] = flags[key];
    }

    function watchOptions() {
      refreshLiveOptions();
      return liveOptions;
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

    function decodeEventFlags(section) {
      if (!section || typeof section !== 'object' || Array.isArray(section)) return undefined;
      const out = {};
      for (const key of EVENT_KEYS) {
        out[key] = typeof section[key] === 'boolean' ? section[key] : true;
      }
      return out;
    }

    function ensureCardStyles() {
      if (typeof document === 'undefined') return;
      const tagId = 'dsh-helper-plugin-notify-away/card.css';
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']')) return;
      const tag = document.createElement('style');
      tag.dataset.plugin = PLUGIN_NAME;
      tag.dataset.pluginCss = tagId;
      tag.textContent = [
        '.dshNa_card{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none}',
        '.dshNa_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
        '.dshNa_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}',
        '.dshNa_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}',
        '.dshNa_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}',
        '.dshNa_plugin{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.4;font-weight:500;word-break:break-all}',
        '.dshNa_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}',
        '.dshNa_about{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.6;margin:0;padding:4px 0 8px}',
        '.dshNa_repo{margin:0 0 8px;font-size:12px;line-height:1.5}',
        '.dshNa_repo a{color:var(--dsw-alias-brand-primary);word-break:break-all}',
        '.dshNa_unsaved{color:var(--dsw-alias-label-secondary);font-size:12px;flex:none}',
        '.dshNa_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}',
        '.dshNa_chevronOpen{transform:rotate(180deg)}',
        '.dshNa_body{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding:8px 0 12px;display:flex;flex-direction:column;gap:2px}',
        '.dshNa_kind{align-items:center;gap:10px;padding:10px 0;display:flex;border-top:.5px solid var(--dsw-alias-border-l2)}',
        '.dshNa_kind input{width:16px;height:16px;flex:none}',
        '.dshNa_kindLabel{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}',
        '.dshNa_kindHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;display:block;font-weight:400}',
        '.dshNa_footer{border-top:.5px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}',
        '.dshNa_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}',
        '.dshNa_discard,.dshNa_save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}',
        '.dshNa_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}',
        '.dshNa_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}',
        '.dshNa_discard:disabled,.dshNa_save:disabled{opacity:.4;cursor:default}',
      ].join('');
      document.head.appendChild(tag);
    }

    const SETTINGS_COPY = {
      zh: {
        title: '离开时通知',
        plugin: PLUGIN_NAME,
        description: '插件 dsh-helper-plugin-notify-away：离开这场会话时才弹系统通知。切到别的窗口、别的实例，或当前面板没显示时会提醒；正在看这场会话、helper 也在前台时保持安静。默认五种全开，可按种类关掉。',
        intro: '这是 dsh-helper 插件 dsh-helper-plugin-notify-away。会话结束、需要审批、提问、计划待审，或其他卡住等人的情况，会在你离开这场会话时弹出系统通知。盯着这场会话、窗口也在前台时不弹。下面每种都可以单独关掉，保存后立刻生效，默认全开。',
        repoLabel: '源码',
        expand: '展开',
        collapse: '收起',
        unsaved: '未保存',
        discard: '放弃',
        save: '保存',
        saving: '保存中',
        saveFailed: '保存失败，请重试。',
        completion: '任务完成',
        completionHint: '会话从运行变为结束时（取消也会结束）。',
        approval: '等待审批',
        approvalHint: '需要你批准一条命令或权限时。',
        question: '等待回答',
        questionHint: 'Agent 停下来向你提问时。',
        planReview: '计划待审',
        planReviewHint: '计划写好了，等你确认时。',
        otherWait: '其他等待',
        otherWaitHint: '以后新出现的卡住等人的种类。',
      },
      en: {
        title: 'Notify when away',
        plugin: PLUGIN_NAME,
        description: 'Plugin dsh-helper-plugin-notify-away: toast only when you leave this session — another window, another instance, or this panel hidden. Silent while you watch it and helper is in front. All five kinds are on by default; turn any off below.',
        intro: 'This is the dsh-helper plugin dsh-helper-plugin-notify-away. Completions, approvals, questions, plan review, and other waits toast when you are away from that session. No toast while you are looking at it with the helper in front. Each kind can be turned off; a save takes effect immediately. All kinds default on.',
        repoLabel: 'Source',
        expand: 'Expand',
        collapse: 'Collapse',
        unsaved: 'Unsaved',
        discard: 'Discard',
        save: 'Save',
        saving: 'Saving',
        saveFailed: 'Could not save. Try again.',
        completion: 'Task finished',
        completionHint: 'When a session goes from running to idle (cancel also idles).',
        approval: 'Waiting for approval',
        approvalHint: 'When a command or permission needs your approval.',
        question: 'Waiting for answer',
        questionHint: 'When the agent stops to ask you a question.',
        planReview: 'Plan awaiting review',
        planReviewHint: 'When a plan is ready for you to confirm.',
        otherWait: 'Other waits',
        otherWaitHint: 'Any later pending kind the sidebar does not name yet.',
      },
    };

    function createCardStore(scope) {
      const listeners = new Set();
      let draft;
      let saving = false;
      let failed = false;
      let open = false;
      let cached;

      function flagsFor(snap) {
        if (snap.status === 'ready' && snap.value) return { ...snap.value };
        const flags = {};
        for (const key of EVENT_KEYS) flags[key] = true;
        return flags;
      }

      function currentFlags() {
        return flagsFor(scope.getSnapshot());
      }

      function projectionFor(snap) {
        const value = flagsFor(snap);
        const staged = draft ?? value;
        const user = snap.user && typeof snap.user === 'object' ? snap.user : {};
        const dirty = EVENT_KEYS.some((key) => staged[key] !== value[key]);
        return {
          available: snap.status === 'ready',
          writable: snap.writable === true,
          dirty,
          saving,
          failed,
          open,
          flags: staged,
          overridden: Object.fromEntries(EVENT_KEYS.map((key) => [key, Object.prototype.hasOwnProperty.call(user, key)])),
        };
      }

      /** Whether two projections render the same thing, field for field. */
      function sameProjection(a, b) {
        if (a === undefined) return false;
        return a.available === b.available
          && a.writable === b.writable
          && a.dirty === b.dirty
          && a.saving === b.saving
          && a.failed === b.failed
          && a.open === b.open
          && EVENT_KEYS.every((key) => a.flags[key] === b.flags[key] && a.overridden[key] === b.overridden[key]);
      }

      /**
       * The renderer binds this store to `useSyncExternalStoreWithSelector`,
       * which compares consecutive snapshots with `Object.is`. A fresh object
       * per call therefore re-renders forever until React throws, the slot's
       * error boundary swallows the entry, and the card never shows. So the
       * rendered projection is cached and only replaced when a field moves —
       * neither the scope snapshot's identity nor a local flag can leak a new
       * reference into React on its own.
       *
       * @returns {object} the current projection, reference-stable until a change.
       */
      function getSnapshot() {
        const next = projectionFor(scope.getSnapshot());
        if (sameProjection(cached, next)) return cached;
        cached = next;
        return cached;
      }

      function publish() {
        for (const listener of listeners) listener();
      }

      scope.subscribe(() => {
        if (!saving) {
          draft = undefined;
          failed = false;
        }
        publish();
      });

      return {
        getSnapshot,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        setOpen(next) {
          open = next;
          publish();
        },
        toggle(key) {
          const next = { ...(draft ?? currentFlags()) };
          next[key] = !next[key];
          draft = next;
          failed = false;
          publish();
        },
        discard() {
          draft = undefined;
          failed = false;
          publish();
        },
        async save() {
          const snap = scope.getSnapshot();
          const staged = draft ?? currentFlags();
          const value = currentFlags();
          const ops = [];
          for (const key of EVENT_KEYS) {
            if (staged[key] === value[key]) continue;
            ops.push({ op: 'set', path: [key], value: staged[key] });
          }
          if (ops.length === 0) return;
          saving = true;
          failed = false;
          publish();
          try {
            await scope.mutate(ops, snap.revision);
            draft = undefined;
            failed = false;
            open = false;
          } catch {
            failed = true;
          } finally {
            saving = false;
            publish();
          }
        },
      };
    }

    function NotifyAwayCard(props) {
      const React = props.React;
      const { t, useNotifyAwayCard } = props;
      const el = React.createElement;
      const title = t('title');
      const state = useNotifyAwayCard((snapshot) => snapshot);
      const [open, setOpen] = React.useState(false);
      const saveStarted = React.useRef(false);
      // Collapse only after a save finishes. Toggling a checkbox back to the
      // stored value clears "dirty" but must not fold the card — that is still
      // an edit in progress, same as 终端 / Agent 循环.
      React.useEffect(() => {
        if (state.saving) {
          saveStarted.current = true;
          return;
        }
        if (!saveStarted.current) return;
        saveStarted.current = false;
        if (!state.dirty && !state.failed) setOpen(false);
      }, [state.dirty, state.failed, state.saving]);
      return el('li', { className: 'dshNa_card' + (open ? ' dshNa_cardOpen' : '') },
        el('button', {
          type: 'button',
          className: 'dshNa_header',
          'aria-expanded': open,
          'aria-label': `${t(open ? 'collapse' : 'expand')}: ${title}`,
          onClick: () => setOpen(!open),
        },
          el('span', { className: 'dshNa_headText' },
            el('span', { className: 'dshNa_name' }, title),
            el('span', { className: 'dshNa_plugin' }, t('plugin')),
            el('span', { className: 'dshNa_description' }, t('description')),
          ),
          state.dirty ? el('span', { className: 'dshNa_unsaved' }, t('unsaved')) : null,
          el('span', { className: 'dshNa_chevron' + (open ? ' dshNa_chevronOpen' : ''), 'aria-hidden': true }, '▾'),
        ),
        open ? el('div', { className: 'dshNa_body' },
          el('p', { className: 'dshNa_about' }, t('intro')),
          el('p', { className: 'dshNa_repo' },
            `${t('repoLabel')}: `,
            el('a', {
              href: PLUGIN_REPO,
              target: '_blank',
              rel: 'noopener noreferrer',
              onClick: (event) => event.stopPropagation(),
            }, PLUGIN_REPO),
          ),
          ...EVENT_KEYS.map((key) => el('label', { key, className: 'dshNa_kind' },
            el('input', {
              type: 'checkbox',
              checked: state.flags[key] !== false,
              disabled: !state.writable || state.saving,
              onChange: () => props.toggle(key),
            }),
            el('span', { className: 'dshNa_kindLabel' },
              t(key),
              el('span', { className: 'dshNa_kindHint' }, t(`${key}Hint`)),
            ),
          )),
          el('div', { className: 'dshNa_footer' },
            state.failed ? el('p', { className: 'dshNa_failed', role: 'status' }, t('saveFailed')) : null,
            el('button', {
              type: 'button',
              className: 'dshNa_discard',
              disabled: !state.dirty || state.saving,
              onClick: props.discard,
            }, t('discard')),
            el('button', {
              type: 'button',
              className: 'dshNa_save',
              disabled: !state.dirty || state.saving,
              onClick: props.save,
            }, t(state.saving ? 'saving' : 'save')),
          ),
        ) : null,
      );
    }

    function attachSettings(owner) {
      return owner.effect(() => {
        if (
          !owner.settingsScope
          || typeof owner.settingsScope.bind !== 'function'
          || !owner.slots
          || typeof owner.slots.inject !== 'function'
        ) {
          return () => {};
        }

        let React;
        try {
          React = require('react');
        } catch {
          React = typeof globalThis !== 'undefined' ? globalThis.React : undefined;
        }
        if (!React || typeof React.createElement !== 'function') {
          try { console.warn('[notify-away] React is not available; 插件配置 card skipped'); } catch { /* ignore */ }
          return () => {};
        }

        const scope = owner.settingsScope.bind({
          namespace: SETTINGS_NAMESPACE,
          decode: decodeEventFlags,
        });
        const applySnapshot = () => {
          const snap = scope.getSnapshot();
          settingsFlags = snap.status === 'ready' && snap.value ? snap.value : {};
          refreshLiveOptions();
        };
        applySnapshot();
        const stopScope = typeof scope.subscribe === 'function' ? scope.subscribe(applySnapshot) : () => {};
        const store = createCardStore(scope);
        // `locale` is ambient copy, not a declared dependency of this card, so it
        // MUST be read through the non-strict accessor: cordis throws
        // `cannot get property "locale" without inject` on `owner.locale` for a
        // fiber that never injected it, and that throw landed here — before the
        // registration — so the card silently never appeared.
        const locale = typeof owner.get === 'function' ? owner.get('locale') : undefined;
        if (locale && typeof locale.register === 'function') {
          locale.register(SETTINGS_LOCALE_NS, SETTINGS_COPY);
        }
        ensureCardStyles();
        const t = locale && typeof locale.bind === 'function'
          ? locale.bind(SETTINGS_LOCALE_NS)
          : (key) => SETTINGS_COPY.zh[key] ?? SETTINGS_COPY.en[key] ?? key;
        try { console.info('[notify-away] registering settings.plugin.item card'); } catch { /* ignore */ }
        const stopSlot = owner.slots.inject('settings.plugin.item', function* () {
          yield owner.slots.register(
            {
              name: 'settings.plugin.item',
              key: SETTINGS_NAMESPACE,
              // The renderer builds the `t` seat from this namespace and refuses to
              // render an entry that declares one while no locale face is
              // installed, so only declare it when that face really exists — the
              // injected `t` below carries our copy either way.
              ...locale === undefined ? {} : { locale: SETTINGS_LOCALE_NS },
              inject: () => ({
                hooks: { notifyAwayCard: store },
                React,
                t,
                toggle: (key) => store.toggle(key),
                discard: () => store.discard(),
                save: () => store.save(),
              }),
            },
            NotifyAwayCard,
          );
        });
        return () => {
          stopScope();
          if (typeof stopSlot === 'function') stopSlot();
        };
      }, 'notify-away: settings card');
    }

    exports.name = PLUGIN_NAME;
    // Static inject stays `sessions` so boot matches the previously-working row.
    // `uiSession` is provided later by the session UI package; wait for it via
    // ctx.inject when Cordis offers that, otherwise read it if already present.
    exports.inject = ['sessions'];
    exports.apply = (ctx, rawConfig) => {
      rowEvents = rawConfig;
      refreshLiveOptions();
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
        // locale is optional copy; waiting on it blocked the card when the
        // service name lagged. slots.inject itself waits until the Plugins
        // tab declares settings.plugin.item.
        ctx.inject(['slots', 'settingsScope'], attachSettings);
      } else {
        attachWaitWatcher(ctx);
        attachSettings(ctx);
      }
    };

    return module.exports;
  },
});
