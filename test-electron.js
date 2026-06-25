const fs = require('fs');
fs.writeFileSync('C:/Users/Pavni/AppData/Local/Temp/electron-test-out.json', JSON.stringify({
  electron: process.versions.electron,
  node: process.versions.node,
  type: process.type,
  argv: process.argv
}, null, 2));
process.exit(0);
