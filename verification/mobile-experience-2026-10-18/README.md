# Mobile experience evidence

Read [record](record.md), [device checklist](DEVICE_CHECKLIST.md), [spec](../../docs/superpowers/specs/2026-10-18-mobile-experience.md) and [plan](../../docs/superpowers/plans/2026-10-18-mobile-experience.md).

`layout-result.json` and `screenshots/` come from actual changed React Native components rendered through React Native Web with an explicit fictional fixture. They are layout proxies, not native device, keyboard, inset, font-scaling or provider acceptance. No real session, storage, API, private company content or remote provider is used. Requests outside the owned preview are blocked by the screenshot harness.

Reproduce from the feature worktree root, with committed mobile dependencies already installed:

```bash
node verification/mobile-experience-2026-10-18/preview/serve.mjs
```

In another terminal:

```bash
node verification/mobile-experience-2026-10-18/capture.mjs
```

The preview uses only localhost5186; capture uses an isolated owned Chromium profile/debug port19386 and terminates only its own process group. An already-occupied port is an error: inspect identity instead of stopping an unknown process. Stop your preview with Ctrl+C after use. Native safe-area module resolution is explicitly web-specific in this fixture; production Metro configuration is unchanged.

Screens cover320/390/430 widths, optional verification, error, long names, enlarged-text CSS proxy, module search/empty state and below-the-fold controls. Open the PNGs; a JSON assertion alone is not visual review. Native tabs/navigation and native keyboard behavior are not rendered by this isolated fixture.
