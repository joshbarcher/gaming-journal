# Lucide Icons

This project does **not** use the `lucide-svelte` (or any other Lucide) package. There is no `import { ExternalLink } from 'lucide-svelte'`.

Instead, icons are rendered as **inline SVG path data** copied directly from [lucide.dev](https://lucide.dev). The SVG wrapper is written by hand and the icon paths are pasted inside it.

## Pattern

```svelte
<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    width="16"
    height="16">
    <!-- paste Lucide path(s) here -->
    <path d="M15 3h6v6"/>
    <path d="M10 14 21 3"/>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
</svg>
```

The SVG attributes are the same every time — only the inner `<path>`, `<circle>`, `<line>`, etc. elements change.

## Getting the paths

1. Go to [lucide.dev](https://lucide.dev) and find the icon.
2. Click **Copy SVG**.
3. Paste the inner elements (everything between `<svg>` and `</svg>`) into the wrapper above.

## Helper pattern (used in FlagsBar.svelte)

When many icons are needed in one file, a local helper avoids repeating the wrapper:

```ts
const SVG = (paths: string) =>
    `<svg class="my-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

// Usage
const icon = SVG(`<path d="M15 3h6v6"/><path d="M10 14 21 3"/>`)
```

Inject with `{@html icon}` in the template.

## Why not lucide-svelte?

No strong reason — it just was never added. If the number of icons grows significantly, installing `lucide-svelte` would be a reasonable step. For now, inline paths keep the bundle lean and avoid a dependency for what amounts to a handful of icons.
