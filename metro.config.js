const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = getDefaultConfig(__dirname);
config.resolver.extraNodeModules = {
	...(config.resolver.extraNodeModules ?? {}),
	'@babel/runtime': path.resolve(__dirname, 'node_modules/@babel/runtime'),
	react: path.resolve(__dirname, 'node_modules/react'),
	'react-native': path.resolve(__dirname, 'node_modules/react-native')
};

module.exports = withNativeWind(config, { input: './global.css' });
