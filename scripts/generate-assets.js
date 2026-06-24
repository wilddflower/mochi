// Run this with: node scripts/generate-assets.js
// Generates placeholder PNG assets using pure Node.js (no native deps)
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

function makeRGBPng(width, height, r, g, b) {
  // PNG signature
  const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A])

  // IHDR chunk: width, height, bit depth 8, color type 2 (RGB), compression 0, filter 0, interlace 0
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData[8] = 8   // bit depth
  ihdrData[9] = 2   // color type: RGB
  ihdrData[10] = 0  // compression
  ihdrData[11] = 0  // filter
  ihdrData[12] = 0  // interlace
  const ihdr = makeChunk('IHDR', ihdrData)

  // IDAT: raw pixel data with filter byte 0 per row
  const rawRows = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3)
    row[0] = 0 // filter type: None
    for (let x = 0; x < width; x++) {
      row[1 + x*3] = r
      row[2 + x*3] = g
      row[3 + x*3] = b
    }
    rawRows.push(row)
  }
  const raw = Buffer.concat(rawRows)
  const compressed = zlib.deflateSync(raw)
  const idat = makeChunk('IDAT', compressed)

  // IEND
  const iend = makeChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([sig, ihdr, idat, iend])
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  const crcData = Buffer.concat([typeBuf, data])
  crcBuf.writeUInt32BE(crc32(crcData), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

// CRC32 implementation
function crc32(buf) {
  let table = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[n] = c
  }
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

const spritesDir = path.join(__dirname, '..', 'assets', 'sprites')
const assetsDir = path.join(__dirname, '..', 'assets')
fs.mkdirSync(spritesDir, { recursive: true })

// Tray icon: 16x16 pink (#E87D92)
fs.writeFileSync(path.join(assetsDir, 'tray-icon.png'), makeRGBPng(16, 16, 232, 125, 146))
console.log('Generated: assets/tray-icon.png')

// Placeholder sprites per mood (32x32, different tints)
const moodColors = {
  happy:       [255, 182, 193], // light pink
  focused:     [147, 197, 253], // light blue
  encouraging: [167, 243, 208], // light green
  sad:         [196, 181, 253], // light purple
  angry:       [252, 165, 165], // light red
  nagging:     [253, 186, 116], // light orange
  sleeping:    [209, 213, 219]  // light gray
}

for (const [mood, [r,g,b]] of Object.entries(moodColors)) {
  const png = makeRGBPng(32, 32, r, g, b)
  fs.writeFileSync(path.join(spritesDir, `${mood}.png`), png)
  console.log(`Generated: assets/sprites/${mood}.png`)
}

console.log('\nAll placeholder assets generated.')
console.log('Replace these with real pixel-art sprites when ready.')
