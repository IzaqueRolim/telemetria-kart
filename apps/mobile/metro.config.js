// Monorepo: o Expo detecta workspaces automaticamente. Garantimos apenas que o
// pacote compartilhado seja lido do código-fonte TypeScript (campo "react-native").
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.resolverMainFields = ['react-native', 'browser', 'main'];

module.exports = config;
