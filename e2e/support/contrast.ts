import { expect, type Locator, type Page } from "@playwright/test";

/**
 * WCAG 2.x contrast of rendered text, read from computed styles in the page (EXF-472, the light theme).
 * The background is found by walking the ancestors and compositing each translucent layer over the first opaque
 * one (the page itself is the last layer). Gradients and images are not understood: a probe on one reports NaN.
 */
export type Probe = { ratio: number; fg: string; bg: string };

/** Runs in the page: serialisable on its own, so it can be passed to evaluate. */
function probeInPage(el: Element): Probe {
  type RGBA = [number, number, number, number];
  const parse = (s: string): RGBA => {
    const m = s.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
    return [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0, m[3] ?? 1];
  };
  const over = (top: RGBA, under: RGBA): RGBA => {
    const a = top[3] + under[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    const c = (i: 0 | 1 | 2) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a;
    return [c(0), c(1), c(2), a];
  };
  const lum = ([r, g, b]: RGBA) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const layers: RGBA[] = [];
  let hasImage = false;
  for (let n: Element | null = el; n; n = n.parentElement) {
    const st = getComputedStyle(n);
    if (st.backgroundImage !== "none") hasImage = true;
    const c = parse(st.backgroundColor);
    if (c[3] > 0) layers.push(c);
    if (c[3] === 1) break;
  }
  let bg: RGBA = [255, 255, 255, 1];
  if (layers.at(-1)?.[3] !== 1) layers.push(bg);
  bg = layers.reduceRight((under, top) => over(top, under));
  const own = parse(getComputedStyle(el).color);
  const fg = over(own, bg);
  const l1 = lum(fg);
  const l2 = lum(bg);
  const ratio = hasImage ? Number.NaN : (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  const rgb = (c: RGBA) => `rgb(${c.slice(0, 3).map(Math.round).join(", ")})`;
  return { ratio, fg: rgb(fg), bg: rgb(bg) };
}

export async function contrastOf(locator: Locator): Promise<number> {
  return (await locator.evaluate(probeInPage)).ratio;
}

export async function expectContrast(locator: Locator, min = 4.5) {
  await expect(locator).toBeVisible();
  const p = await locator.evaluate(probeInPage);
  expect(p.ratio, `text ${p.fg} on ${p.bg}`).toBeGreaterThanOrEqual(min);
}

export type Weak = { where: string; text: string; ratio: number; fg: string; bg: string };

/** Every visible text element under `scope` (the page when omitted) whose contrast is below `min`. Disabled controls are exempt (WCAG). */
export async function weakText(page: Page, scope?: Locator, min = 4.5): Promise<Weak[]> {
  const root = scope ?? page.locator("body");
  return root.evaluate(
    (rootEl, args) => {
      const { min, probeSrc } = args;
      const probe = new Function(`return (${probeSrc})`)() as (e: Element) => Probe;
      const out: Weak[] = [];
      const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
      const seen = new Set<Element>();
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const el = t.parentElement;
        if (!el || seen.has(el) || !t.textContent?.trim()) continue;
        seen.add(el);
        if (["SCRIPT", "STYLE", "OPTION"].includes(el.tagName)) continue;
        const st = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || st.visibility === "hidden" || st.display === "none")
          continue;
        if (el.closest(":disabled, [aria-disabled='true']")) continue;
        const p = probe(el);
        if (Number.isNaN(p.ratio) || p.ratio >= min) continue;
        const cls =
          typeof el.className === "string" && el.className
            ? `.${el.className.split(" ").join(".")}`
            : "";
        out.push({
          where: `${el.tagName.toLowerCase()}${cls}`,
          text: (t.textContent ?? "").trim().slice(0, 40),
          ...p,
        });
      }
      return out;
    },
    { min, probeSrc: probeInPage.toString() },
  );
}
