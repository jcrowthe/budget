// Pure sidebar sizing rules (no React, no DOM).
export const SIDEBAR_DEFAULT = 260;
export const SIDEBAR_COLLAPSED = 56;
export const SIDEBAR_MAX = 600;
export const SNAP_AT = 150;
export const NARROW_AT = 220;
export const KEY_COLLAPSED = "sidebar-is-collapsed";
export const KEY_WIDTH = "sidebar-preferred-width";

export type SidebarSaved = { collapsed: boolean; preferred: number };

export function readSidebarState(get: (k: string) => string | null): SidebarSaved {
  try {
    const collapsed = get(KEY_COLLAPSED) === "true";
    const raw = get(KEY_WIDTH);
    const n = raw !== null && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    const preferred = n > SNAP_AT && n <= SIDEBAR_MAX ? n : SIDEBAR_DEFAULT;
    return { collapsed, preferred };
  } catch {
    return { collapsed: false, preferred: SIDEBAR_DEFAULT };
  }
}

export function clampWidth(w: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_COLLAPSED, Math.round(w)));
}

export function releaseWidth(live: number): SidebarSaved {
  return live <= SNAP_AT
    ? { collapsed: true, preferred: SIDEBAR_DEFAULT }
    : { collapsed: false, preferred: Math.round(live) };
}

export function isNarrow(w: number): boolean {
  return w > SNAP_AT && w <= NARROW_AT;
}
