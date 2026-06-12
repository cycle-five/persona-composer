import type { SiteAdapter } from "../types";
import { xAdapter } from "./x";
import { igAdapter } from "./instagram";

/** Pick the adapter for the current host, or null if this isn't a site we know. */
export function getAdapter(host: string = location.hostname): SiteAdapter | null {
  if (host === "x.com" || host.endsWith(".x.com") || host.endsWith("twitter.com")) {
    return xAdapter;
  }
  if (host.endsWith("instagram.com")) {
    return igAdapter;
  }
  return null;
}
