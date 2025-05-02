import type { JSX } from "npm:solid-js";
import { type RequestEvent, getRequestEvent } from "npm:solid-js/web";
import { type BaseRouterProps, createRouterComponent } from "./components.tsx";

function getPath(url: string) {
  const u = new URL(url);
  return u.pathname + u.search;
}

export type StaticRouterProps = BaseRouterProps & { url?: string };

export function StaticRouter(props: StaticRouterProps): JSX.Element {
  let e: RequestEvent | undefined;
  const obj = {
    value: props.url || ((e = getRequestEvent()) && getPath(e.request.url)) || "",
  };
  return createRouterComponent({
    signal: [() => obj, (next: any) => Object.assign(obj, next)],
  })(props);
}
