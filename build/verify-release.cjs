const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async function verifyRelease(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const bundle = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
  execFileSync('/usr/bin/xcrun', ['stapler', 'validate', bundle], { stdio: 'inherit' });
};
