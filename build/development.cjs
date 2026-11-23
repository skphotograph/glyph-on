const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const release = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'electron-builder.yml'), 'utf8'));
const { afterSign, publish, ...config } = release;

module.exports = {
  ...config,
  publish: null,
  forceCodeSigning: false,
  directories: { ...config.directories, output: 'dist/dev' },
  win: { ...config.win, signExecutable: false },
  mac: { ...config.mac, identity: null, notarize: false }
};
