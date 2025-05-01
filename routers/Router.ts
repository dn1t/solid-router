import type { JSX } from "solid-js";
import { isServer } from "solid-js/web";
import { setupNativeEvents } from "../data/events";
import { createBeforeLeave, keepDepth, notifyIfNotBlocked, saveCurrentDepth } from "../lifecycle";
import type { BaseRouterProps } from "./components";
import { bindEvent, createRouter, scrollToHash } from "./createRouter";
import { StaticRouter } from "./StaticRouter";

export type RouterProps = BaseRouterProps & {
  url?: string;
  actionBase?: string;
  explicitLinks?: boolean;
  preload?: boolean;
};

export function Router(props: RouterProps): JSX.Element {
  if (isServer) return StaticRouter(props);
  const getSource = () => {
    const url = window.location.pathname.replace(/^\/+/, "/") + window.location.search;
    const state =
      window.history.state?._depth && Object.keys(window.history.state).length === 1
        ? undefined
        : window.history.state;
    return {
      value: url + window.location.hash,
      state,
    };
  };
  const beforeLeave = createBeforeLeave();
  return createRouter({
    get: getSource,
    set({ value, replace, scroll, state }) {
      if (replace) {
        window.history.replaceState(keepDepth(state), "", value);
      } else {
        window.history.pushState(state, "", value);
      }
      scrollToHash(decodeURIComponent(window.location.hash.slice(1)), scroll);
      saveCurrentDepth();
    },
    init: (notify) =>
      bindEvent(
        window,
        "popstate",
        notifyIfNotBlocked(notify, (delta) => {
          if (delta && delta < 0) {
            return !beforeLeave.confirm(delta);
          }
          const s = getSource();
          return !beforeLeave.confirm(s.value, { state: s.state });
        }),
      ),
    create: setupNativeEvents(
      props.preload,
      props.explicitLinks,
      props.actionBase,
      props.transformUrl,
    ),
    utils: {
      go: (delta) => window.history.go(delta),
      beforeLeave,
    },
  })(props);
}
