// Metro (the Expo bundler) crawls every folder in the project. The online store in ./website is a separate Next.js project with its own
// node_modules (tens of thousands of files, many with the same package names as the app's): keep it out of the app's bundler entirely.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const websiteFolder = new RegExp(`${__dirname.replace(/[\\/]/g, '[\\\\/]')}[\\\\/]website[\\\\/].*`);
const existing = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), websiteFolder];

module.exports = config;
