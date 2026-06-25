# Mochi sprite frames

Drop your bunny PNGs here and restart the app — Mochi auto-loads them.

## Naming

Use `<mood>-<number>.png` for animations, or `<mood>.png` for a single still frame:

```
encouraging-1.png   encouraging-2.png   encouraging-3.png   ← ears moving (greeting / idle)
happy-1.png         happy-2.png                              ← productive / working
sad-1.png           sad-2.png                                ← opened a distraction
angry-1.png         angry-2.png                              ← 5+ min distracted
celebrate-1.png     celebrate-2.png                          ← whole to-do list finished
```

- Frames play in number order, looping.
- A mood with a single file (e.g. `happy.png`) shows as a still with a gentle bob.

## Moods Mochi uses

`encouraging` · `happy` · `sad` · `angry` · `celebrate`

Optional extras (auto-fall back if you don't make them):
- `focused` → falls back to `happy`
- `nagging` → falls back to `angry`
- `sleeping` → falls back to `sad`

## Export tips (transparent background)

Best for pixel art: **export straight from Figma** — hide/delete the background
layer behind the bunny, select the bunny frame, Export → **PNG**. Figma gives you a
clean transparent background with crisp edges.

Avoid Canva/remove.bg for pixel art — they soften edges and can leave a faint halo.

Export each animation frame as its own PNG, all the same canvas size so the bunny
doesn't jump around between frames.
