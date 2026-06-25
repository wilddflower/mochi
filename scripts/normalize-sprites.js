// Normalizes every PNG in assets/sprites so all frames share one canvas size,
// are trimmed of transparent padding, scaled to a uniform height, and
// bottom-anchored. This fixes two problems:
//   1. Frames jumping/resizing between each other (different source dimensions)
//   2. Mochi "floating" above the taskbar (transparent padding below her feet)
//
// Run from the repo root:  node scripts/normalize-sprites.js
const fs = require('fs')
const path = require('path')
const Jimp = require('jimp')

const DIR = path.join(__dirname, '..', 'assets', 'sprites')

async function main() {
  const files = fs.readdirSync(DIR).filter(f => f.toLowerCase().endsWith('.png'))
  const frames = []

  for (const file of files) {
    const img = await Jimp.read(path.join(DIR, file))
    img.autocrop({ tolerance: 0, cropOnlyFrames: false }) // trim transparent border
    frames.push({ file, img, w: img.bitmap.width, h: img.bitmap.height })
    console.log(`trimmed ${file.padEnd(18)} → ${img.bitmap.width} x ${img.bitmap.height}`)
  }

  // Scale every bunny to the same content height (upscale only → keeps pixels crisp).
  const targetH = Math.max(...frames.map(f => f.h))
  for (const f of frames) {
    if (f.h !== targetH) {
      const newW = Math.round(f.w * (targetH / f.h))
      f.img.resize(newW, targetH, Jimp.RESIZE_NEAREST_NEIGHBOR)
      f.w = f.img.bitmap.width
      f.h = f.img.bitmap.height
    }
  }

  // Uniform canvas = widest frame × shared height. Place each bottom-centered.
  const canvasW = Math.max(...frames.map(f => f.w))
  const canvasH = targetH
  for (const f of frames) {
    const canvas = new Jimp(canvasW, canvasH, 0x00000000)
    const x = Math.round((canvasW - f.w) / 2)
    canvas.composite(f.img, x, 0) // height already == canvasH → feet at bottom
    await canvas.writeAsync(path.join(DIR, f.file))
    console.log(`normalized ${f.file.padEnd(18)} → ${canvasW} x ${canvasH}`)
  }

  console.log(`\nDone. All frames are now ${canvasW} x ${canvasH}.`)
}

main().catch(e => { console.error(e); process.exit(1) })
