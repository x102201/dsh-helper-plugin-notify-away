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
 * The live switches come from the Host's settings namespace — the Loader row
 * id `notify-away`, read through `ctx.configForms.get()` — and the page that
 * edits them is registered into the Plugins panel's `plugins.bundle.config`
 * slot keyed by this package name, so it opens from OUR installed bundle card
 * (not from the official plugin list). Both are 0.2 harness contracts: the 0.1
 * `settingsScope` service and the `settings.plugin.item` slot no longer exist,
 * so reading or registering against them silently disables configuration.
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
    // Shipped default is OFF: toast wherever you look, and let the card's switch
    // opt into the away-only behavior. Matches lib/config.js and index.js Config.
    const ONLY_WHEN_AWAY = false;
    const INCLUDE_SUBAGENTS = false;
    const EVENT_KEYS = ['completion', 'approval', 'question', 'planReview', 'otherWait'];
    // Gate switches first: they decide *whether* to toast at all, then the
    // five kinds decide which events do. Every one is a volatile Config field,
    // so all of them are live-editable from the 插件 page.
    const GATE_KEYS = ['onlyWhenAway', 'includeSubagents'];
    const LIVE_KEYS = [...GATE_KEYS, ...EVENT_KEYS];
    const LIVE_DEFAULTS = Object.freeze({
      onlyWhenAway: ONLY_WHEN_AWAY,
      includeSubagents: INCLUDE_SUBAGENTS,
      completion: true,
      approval: true,
      question: true,
      planReview: true,
      otherWait: true,
    });
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
      const prevRunning = new Map();

      const onChange = () => {
        // Read the gates per event, not once at mount: both are live switches
        // the 插件 page writes while this watcher stays mounted.
        const onlyWhenAway = options.onlyWhenAway === true;
        const includeSubagents = options.includeSubagents === true;
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
      const prevKeys = new Map();

      const onChange = () => {
        // Same as watchCompletions: the gates are read per event so a live
        // switch takes effect without remounting the watcher.
        //
        // `includeSubagents` deliberately does not gate waits: a child agent
        // blocked on approval or a question needs you just as much as a root
        // session, and the card's copy only promises to gate finishes.
        const onlyWhenAway = options.onlyWhenAway === true;
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

    /**
     * Read every live switch from the sources that can carry one, in
     * precedence order: the Loader row's own config (the bundle patch), then
     * the Host settings namespace (the profile's user layer, live), then the
     * emergency `window.__dshHelperNotifyAway` overlay, which wins.
     */
    function readLiveFlags(rowConfig) {
      const flags = {};
      for (const key of LIVE_KEYS) flags[key] = LIVE_DEFAULTS[key];
      const overlay = (() => {
        try {
          return window.__dshHelperNotifyAway;
        } catch {
          return undefined;
        }
      })();
      for (const source of [rowConfig, settingsFlags, overlay]) {
        if (!source || typeof source !== 'object') continue;
        for (const key of LIVE_KEYS) {
          if (typeof source[key] === 'boolean') flags[key] = source[key];
        }
      }
      return flags;
    }

    function refreshLiveOptions() {
      const flags = readLiveFlags(rowEvents);
      for (const key of LIVE_KEYS) liveOptions[key] = flags[key];
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

    /**
     * Narrow one settings section to the live switches, filling omitted keys
     * with their default. The Host already projects the schema, so this is a
     * belt-and-braces guard against a namespace read from a different shape.
     */
    function decodeEventFlags(section) {
      if (!section || typeof section !== 'object' || Array.isArray(section)) return undefined;
      const out = {};
      for (const key of LIVE_KEYS) {
        out[key] = typeof section[key] === 'boolean' ? section[key] : LIVE_DEFAULTS[key];
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
        // Page body only: the Plugins panel draws the card, icon, title, and
        // crumb around it, so these rules stay close to the official pages.
        '.dshNa_page{display:flex;flex-direction:column;gap:2px}',
        '.dshNa_about{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.6;margin:0;padding:4px 0 6px}',
        '.dshNa_repo{margin:0 0 10px;font-size:12px;line-height:1.5}',
        '.dshNa_repo a{color:var(--dsw-alias-brand-primary);word-break:break-all}',
        '.dshNa_kinds{flex-direction:column;display:flex}',
        '.dshNa_kind{align-items:center;gap:10px;padding:11px 0;display:flex;border-top:.5px solid var(--dsw-alias-border-l2)}',
        '.dshNa_kind input{width:16px;height:16px;flex:none}',
        '.dshNa_kindLabel{flex:1;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5}',
        '.dshNa_kindHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;display:block;font-weight:400}',
        '.dshNa_footer{border-top:.5px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:14px 0 2px;display:flex}',
        '.dshNa_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}',
        '.dshNa_saving{min-width:0;color:var(--dsw-alias-label-tertiary);flex:1;margin:0;font-size:12px;line-height:1.5}',
      ].join('');
      document.head.appendChild(tag);
    }

    const SETTINGS_COPY = {
      zh: {
        title: '离开时通知',
        plugin: PLUGIN_NAME,
        summary: '会话结束或卡住等你时弹系统通知；可勾上「只在离开时提醒」。',
        description: '插件 dsh-helper-plugin-notify-away：默认无论你在看哪儿都会弹系统通知。勾上「只在离开时提醒」后，正在看这场会话、helper 也在前台时保持安静；切到别的窗口、别的实例，或当前面板没显示时照样提醒。下面每种事件都能单独关掉，点一下就立即生效（没有保存按钮）。',
        intro: '这是 dsh-helper 插件 dsh-helper-plugin-notify-away。会话结束、需要审批、提问、计划待审，或其他卡住等人的情况会弹出系统通知。默认无论你在看哪儿都弹；勾上「只在离开时提醒」就只在离开这场会话时弹。每个开关点一下就立即写入，没有保存按钮。',
        repoLabel: '源码',
        expand: '展开',
        collapse: '收起',
        unsaved: '未保存',
        discard: '放弃',
        save: '保存',
        saving: '正在保存…',
        saveFailed: '保存失败，请再点一次这个开关重试。',
        onlyWhenAway: '只在离开时提醒',
        onlyWhenAwayHint: '不勾选（默认）：无论你在看哪儿都弹。勾上后，正在看这场会话、helper 也在前台时不弹。',
        includeSubagents: '包含子智能体',
        includeSubagentsHint: '子会话（由主会话派发的 agent）结束时也提醒。子会话在等你时始终提醒。',
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
        summary: 'Toast when a session finishes or waits on you; away-only is one switch.',
        description: 'Plugin dsh-helper-plugin-notify-away: by default it toasts wherever you are looking. Turn "Only when away" on to stay silent while you watch that session with helper in front — another window, another instance, or a hidden panel still toasts. Every event kind can be switched off, and each switch writes on click (there is no save button).',
        intro: 'This is the dsh-helper plugin dsh-helper-plugin-notify-away. Completions, approvals, questions, plan review, and other waits raise a toast — by default wherever you are looking. Turn "Only when away" on to be notified only while you are away from that session. Every switch writes as you click it; there is nothing to save.',
        repoLabel: 'Source',
        expand: 'Expand',
        collapse: 'Collapse',
        unsaved: 'Unsaved',
        discard: 'Discard',
        save: 'Save',
        saving: 'Saving…',
        saveFailed: 'Could not save. Click that switch once more to retry.',
        onlyWhenAway: 'Only when away',
        onlyWhenAwayHint: 'Off (default): always toast. On: stay silent while you are looking at that session with helper in front.',
        includeSubagents: 'Include subagents',
        includeSubagentsHint: 'Also toast when a delegated child session finishes. A child that waits on you always toasts.',
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

    /**
     * Store behind the plugin page.
     *
     * Every switch writes on click — there is no draft/save step. A draft is
     * exactly what made this card lie: the shared form publishes a snapshot
     * whenever the Host settings document moves, the old store dropped the
     * pending edit on any publish, and "uncheck, then Save" could therefore end
     * in an empty op list and a silent no-op (no write, no error, no toast
     * change).
     *
     * Writes are optimistic: the clicked value renders immediately (`pending`),
     * the Host answer is authoritative, and a refusal or transport failure
     * reverts the switch and reports it.
     *
     * @param {object} scope - ConfigForm for the `notify-away` namespace.
     * @returns {object} store for the renderer.
     */
    function createCardStore(scope) {
      const listeners = new Set();
      let pending = {};
      let inflight = 0;
      let failed = false;
      let cached;

      function flagsFor(snap) {
        if (snap.status === 'ready' && snap.value) return { ...LIVE_DEFAULTS, ...snap.value };
        return { ...LIVE_DEFAULTS };
      }

      /** The Host's saved value. */
      function savedFlags() {
        return flagsFor(scope.getSnapshot());
      }

      /** The saved value with this session's optimistic writes on top. */
      function shownFlags() {
        return { ...savedFlags(), ...pending };
      }

      /** Drop overlays the Host has already confirmed, so a late snapshot cannot revert them. */
      function pruneSettled() {
        const saved = savedFlags();
        for (const [key, value] of Object.entries(pending)) {
          if (saved[key] === value) delete pending[key];
        }
      }

      function projectionFor(snap) {
        const saved = flagsFor(snap);
        const user = snap.user && typeof snap.user === 'object' ? snap.user : {};
        return {
          available: snap.status === 'ready',
          writable: snap.writable === true,
          saving: inflight > 0,
          failed,
          flags: { ...saved, ...pending },
          overridden: Object.fromEntries(LIVE_KEYS.map((key) => [key, Object.prototype.hasOwnProperty.call(user, key)])),
        };
      }

      /** Whether two projections render the same thing, field for field. */
      function sameProjection(a, b) {
        if (a === undefined) return false;
        return a.available === b.available
          && a.writable === b.writable
          && a.saving === b.saving
          && a.failed === b.failed
          && LIVE_KEYS.every((key) => a.flags[key] === b.flags[key] && a.overridden[key] === b.overridden[key]);
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
        // A snapshot from the Host (any settings document move) must never undo
        // a switch the user just clicked; it may only retire an overlay the Host
        // has already confirmed.
        pruneSettled();
        publish();
      });

      return {
        getSnapshot,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        /**
         * Flip one switch and persist it right away.
         *
         * @param {string} key - a {@link LIVE_KEYS} member.
         * @returns {Promise<boolean>} whether the Host accepted the write.
         */
        async toggle(key) {
          const next = !shownFlags()[key];
          pending = { ...pending, [key]: next };
          failed = false;
          inflight += 1;
          publish();
          let accepted = false;
          try {
            // ConfigForm.mutate resolves true for Host acceptance and false for
            // a refused or skipped write; a transport failure rejects.
            const snap = scope.getSnapshot();
            accepted = (await scope.mutate([{ op: 'set', path: [key], value: next }], snap.revision)) !== false;
          } catch {
            accepted = false;
          } finally {
            inflight -= 1;
            if (accepted) {
              pruneSettled();
            } else {
              // Put the saved value back and say so instead of silently keeping
              // a switch that never reached the Host.
              const rest = { ...pending };
              delete rest[key];
              pending = rest;
              failed = true;
            }
            publish();
          }
          return accepted;
        },
      };
    }

    /**
     * The plugin's page inside the Plugins panel. The panel itself draws the
     * card (icon, title from `label`, crumb) and the one-liner, so this renders
     * only the body: the copy and the switches. Each switch writes on click —
     * there is no save button to forget.
     */
    function NotifyAwayCard(props) {
      const React = props.React;
      const { t, useNotifyAwayCard, view } = props;
      const el = React.createElement;
      const state = useNotifyAwayCard((snapshot) => snapshot);
      // The bundle card asks for `view: 'page'`; `summary` is answered too so the
      // same component can serve a one-liner seat without drawing chrome.
      if (view === 'summary') return t('summary');
      const disabled = !state.writable;
      return el('div', { className: 'dshNa_page' },
        el('p', { className: 'dshNa_about' }, t('intro')),
        el('p', { className: 'dshNa_repo' },
          `${t('repoLabel')}: `,
          el('a', {
            href: PLUGIN_REPO,
            target: '_blank',
            rel: 'noopener noreferrer',
          }, PLUGIN_REPO),
        ),
        // Gates first (whether to toast at all), then the five event kinds.
        el('div', { className: 'dshNa_kinds' },
          ...LIVE_KEYS.map((key) => el('label', { key, className: 'dshNa_kind' },
            el('input', {
              type: 'checkbox',
              checked: state.flags[key] !== false,
              disabled,
              onChange: () => props.toggle(key),
            }),
            el('span', { className: 'dshNa_kindLabel' },
              t(key),
              el('span', { className: 'dshNa_kindHint' }, t(`${key}Hint`)),
            ),
          )),
        ),
        el('div', { className: 'dshNa_footer' },
          state.failed
            ? el('p', { className: 'dshNa_failed', role: 'status' }, t('saveFailed'))
            : (state.saving ? el('p', { className: 'dshNa_saving', role: 'status' }, t('saving')) : null),
        ),
      );
    }

    function attachSettings(owner) {
      return owner.effect(() => {
        if (
          !owner.configForms
          || typeof owner.configForms.get !== 'function'
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
          try { console.warn('[notify-away] React is not available; the 插件 page is skipped'); } catch { /* ignore */ }
          return () => {};
        }

        // The namespace IS the Loader row id; `configForms.get` hands back the
        // shared form over the settings mirror, already narrowed to the
        // `.volatile()` fields of the Config schema.
        const form = owner.configForms.get(SETTINGS_NAMESPACE);
        const applySnapshot = () => {
          const snap = typeof form.getSnapshot === 'function' ? form.getSnapshot() : undefined;
          const value = snap && snap.status === 'ready' ? decodeEventFlags(snap.value) : undefined;
          settingsFlags = value ?? {};
          refreshLiveOptions();
        };
        applySnapshot();
        const stopForm = typeof form.subscribe === 'function' ? form.subscribe(applySnapshot) : () => {};
        const store = createCardStore(form);
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
        const registerPage = () => owner.slots.inject('plugins.bundle.config', function* () {
          yield owner.slots.register(
            {
              name: 'plugins.bundle.config',
              // Keyed by the bundle's package name: this is what puts the
              // configuration on OUR installed package page, between its
              // description and its rows — not in the official plugin list.
              key: PLUGIN_NAME,
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
              }),
            },
            NotifyAwayCard,
          );
        });
        // `whileServed` keeps the page alive exactly while the Host serves the
        // namespace, so a deployment without this row shows no trace of it.
        const stopPage = typeof owner.configForms.whileServed === 'function'
          ? owner.configForms.whileServed([SETTINGS_NAMESPACE], registerPage)
          : registerPage();
        try { console.info('[notify-away] registering plugins.bundle.config page'); } catch { /* ignore */ }
        return () => {
          stopForm();
          if (typeof stopPage === 'function') stopPage();
        };
      }, 'notify-away: settings page');
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
        // service name lagged. `configForms` is the 0.2 settings transport, and
        // slots.inject inside it waits until the Plugins panel declares
        // plugins.bundle.config.
        ctx.inject(['slots', 'configForms'], attachSettings);
      } else {
        attachWaitWatcher(ctx);
        attachSettings(ctx);
      }
    };

    return module.exports;
  },
});
