// Normalizes every PNG in assets/sprites so all of Mochi's poses are the SAME
// visual size and sit on the same baseline, regardless of ear position.
//
// Why body-based scaling: scaling by total height makes ears-up poses look
// smaller (ears eat the height). Instead we measure the BODY width (widest
// run in the lower-body band, which excludes ears) and scale every frame so
// the body matches. Then all frames are padded to one uniform canvas,
// bottom-anchored (feet on the same line).
//
// Run from the repo root:  node scripts/normalize-sprites.js
const fs = require('fs')
const path = require('path')
const Jimp = require('jimp')

const DIR = path.join(__dirname, '..', 'assets', 'sprites')
const ALPHA_THRESHOLD = 16
// Body band as a fraction of trimmed height: below the ears, above the feet.
const BODY_TOP = 0.55
const BODY_BOTTOM = 0.92

function bodyWidth(img) {
  const { width, height, data } = img.bitmap
  const y0 = Math.floor(height * BODY_TOP)
  const y1 = Math.floor(height * BODY_BOTTOM)
  let maxW = 0
  for (let y = y0; y < y1; y++) {
    let left = -1, right = -1
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD) {
        if (left < 0) left = x
        right = x
      }
    }
    if (left >= 0) maxW = Math.max(maxW, right - left + 1)
  }
  return maxW || width
}

async function main() {
  const files = fs.readdirSync(DIR).filter(f => f.toLowerCase().endsWith('.png'))
  const frames = []

  for (const file of files) {
    const img = await Jimp.read(path.join(DIR, file))
    img.autocrop({ tolerance: 0, cropOnlyFrames: false })
    const bw = bodyWidth(img)
    frames.push({ file, img, bw })
    console.log(`${file.padEnd(18)} trimmed ${img.bitmap.width}x${img.bitmap.height}  body=${bw}`)
  }

  // Scale every frame so its body width matches the largest body (upscale only).
  const targetBody = Math.max(...frames.map(f => f.bw))
  for (const f of frames) {
    const scale = targetBody / f.bw
    if (Math.abs(scale - 1) > 0.01) {
      f.img.resize(
        Math.round(f.img.bitmap.width * scale),
        Math.round(f.img.bitmap.height * scale),
        Jimp.RESIZE_NEAREST_NEIGHBOR
      )
    }
  }

  // Uniform canvas = widest × tallest. Bottom-anchor + horizontally center.
  const canvasW = Math.max(...frames.map(f => f.img.bitmap.width))
  const canvasH = Math.max(...frames.map(f => f.img.bitmap.height))
  for (const f of frames) {
    const canvas = new Jimp(canvasW, canvasH, 0x00000000)
    const x = Math.round((canvasW - f.img.bitmap.width) / 2)
    const y = canvasH - f.img.bitmap.height // feet on the bottom line
    canvas.composite(f.img, x, y)
    await canvas.writeAsync(path.join(DIR, f.file))
    f.norm = canvas
    console.log(`${f.file.padEnd(18)} -> ${canvasW}x${canvasH}`)
  }

  // Contact sheet for visual verification.
  const cols = frames.length
  const sheet = new Jimp(canvasW * cols, canvasH, 0xffffffff)
  frames.forEach((f, i) => sheet.composite(f.norm, i * canvasW, 0))
  const sheetPath = path.join(require('os').tmpdir(), 'mochi-contact-sheet.png')
  await sheet.writeAsync(sheetPath)
  console.log(`\nAll frames ${canvasW}x${canvasH}. Contact sheet: ${sheetPath}`)
}

main().catch(e => { console.error(e); process.exit(1) })
