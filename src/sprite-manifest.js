const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const SPRITES_DIR = path.join(__dirname, '..', 'assets', 'sprites')
const IMG_EXT = ['.png', '.gif', '.webp', '.jpg', '.jpeg']

// Scans assets/sprites and groups frames by mood.
// Naming convention (case-insensitive):
//   happy-1.png, happy-2.png, ...   -> mood "happy", animated in order
//   sad.png                         -> mood "sad", single static frame
// Returns { mood: [fileURL, fileURL, ...] } sorted by frame number.
function buildSpriteManifest() {
  const manifest = {}
  let files = []
  try {
    files = fs.readdirSync(SPRITES_DIR)
  } catch {
    return manifest
  }

  const grouped = {} // mood -> [{ n, url }]
  for (const file of files) {
    const ext = path.extname(file).toLowerCase()
    if (!IMG_EXT.includes(ext)) continue

    const stem = path.basename(file, ext)
    const m = stem.match(/^(.+?)[-_](\d+)$/)
    const mood = (m ? m[1] : stem).toLowerCase()
    const n = m ? parseInt(m[2], 10) : 1

    // Skip near-empty placeholder stubs (a few bytes) so they don't hide the bunny.
    try {
      if (fs.statSync(path.join(SPRITES_DIR, file)).size < 256) continue
    } catch {}

    if (!grouped[mood]) grouped[mood] = []
    grouped[mood].push({ n, url: pathToFileURL(path.join(SPRITES_DIR, file)).href })
  }

  for (const mood of Object.keys(grouped)) {
    grouped[mood].sort((a, b) => a.n - b.n)
    manifest[mood] = grouped[mood].map(x => x.url)
  }
  return manifest
}

module.exports = { buildSpriteManifest }
