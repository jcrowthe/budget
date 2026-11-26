import type { Locator, Page } from "@playwright/test";

export type Settled = { x: number; y: number; width: number; height: number };

/**
 * Waits until `target` is visible, has stopped moving (same box on two animation frames) and is the topmost
 * element at its centre, retrying until `timeout` ms. Under full-suite load a hit-test can miss while a card
 * above is still loading or a menu is still animating in; retrying turns that into a wait, not a failure.
 * Returns the last box measured, and whether every check held (`ok`), so the caller can assert with its own words.
 * The point must be on the target or inside it; `allowAncestor` also accepts an ancestor of it (off by default: a
 * clipped target whose point lands on body or a container must fail). The target must also be enabled (not
 * `:disabled`, not inside `aria-disabled="true"`) so a press never lands on a disabled item; `allowDisabled` skips that
 * check, for specs that press a disabled control on purpose to assert nothing happens. `inside` also requires the box to lie wholly inside the viewport (mouseClick never scrolls).
 */
export async function settle(
  page: Page,
  target: Locator,
  {
    timeout = 30_000,
    inside = false,
    scroll = false,
    allowAncestor = false,
    allowDisabled = false,
  } = {},
): Promise<{ ok: boolean; box: Settled | null; topmost: boolean; inView: boolean }> {
  const deadline = Date.now() + timeout;
  const vp = page.viewportSize();
  let last = { ok: false, box: null as Settled | null, topmost: false, inView: false };
  for (;;) {
    const visible = await target.isVisible().catch(() => false);
    if (visible) {
      if (scroll) await target.scrollIntoViewIfNeeded().catch(() => {});
      const a = await target.boundingBox();
      await page.evaluate(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      );
      const b = await target.boundingBox();
      const stable =
        !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
      const enabled =
        allowDisabled ||
        (await target
          .evaluate((el) => !el.matches(":disabled") && !el.closest('[aria-disabled="true"]'))
          .catch(() => false));
      if (b) {
        const x = b.x + b.width / 2;
        const y = b.y + b.height / 2;
        const topmost = await target
          .evaluate(
            (el, [px, py, anc]) => {
              const h = document.elementFromPoint(px as number, py as number);
              return !!h && (h === el || el.contains(h) || (anc === true && h.contains(el)));
            },
            [x, y, allowAncestor],
          )
          .catch(() => false);
        const inView =
          !!vp && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height;
        last = { ok: stable && topmost && enabled && (!inside || inView), box: b, topmost, inView };
        if (last.ok) return last;
      }
    }
    if (Date.now() > deadline) return last;
    await page.waitForTimeout(100);
  }
}
