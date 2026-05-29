const path = require('path');
const fs = require('fs');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const nipworkerRoot = path.resolve(__dirname, '../nipworker');

const config = getDefaultConfig(__dirname);

config.watchFolders = [
	...(config.watchFolders ?? []),
	nipworkerRoot,
];
const defaultResolveRequest = config.resolver.resolveRequest;
const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx'];
const resolveSourcePath = absolutePath => {
	if (absolutePath.endsWith('.js') || absolutePath.endsWith('.jsx')) {
		const withoutJsExtension = absolutePath.replace(/\.jsx?$/, '');
		for (const ext of ['.ts', '.tsx']) {
			try {
				fs.accessSync(withoutJsExtension + ext);
				return withoutJsExtension + ext;
			} catch {
				// Try the next TypeScript extension.
			}
		}
	}
	for (const ext of sourceExtensions) {
		try {
			fs.accessSync(absolutePath + ext);
			return absolutePath + ext;
		} catch {
			// Try the next source extension.
		}
	}
	for (const ext of sourceExtensions) {
		try {
			const indexPath = path.join(absolutePath, `index${ext}`);
			fs.accessSync(indexPath);
			return indexPath;
		} catch {
			// Try the next index extension.
		}
	}
	try {
		fs.accessSync(absolutePath);
		return absolutePath;
	} catch {
		// Fall through so Metro can surface the unresolved path.
	}
	return absolutePath;
};
const resolveSourceFile = sourcePath => resolveSourcePath(path.join(nipworkerRoot, sourcePath));
config.resolver.resolveRequest = (context, moduleName, platform) => {
	const nipworkerSource = {
		'@candypoets/nipworker': 'src/index.ts',
		'@candypoets/nipworker/hooks': 'src/hooks.ts',
		'@candypoets/nipworker/utils': 'src/utils.ts',
		'@candypoets/nipworker/native': 'src/native.ts',
		'@candypoets/nipworker/react-native': 'src/react-native.ts',
	};

	const sourcePath = nipworkerSource[moduleName];
	if (sourcePath) {
		return {
			filePath: resolveSourceFile(sourcePath),
			type: 'sourceFile',
		};
	}
	if (
		moduleName.startsWith('src/') &&
		context.originModulePath &&
		context.originModulePath.startsWith(nipworkerRoot)
	) {
		return {
			filePath: resolveSourceFile(moduleName.replace(/^src\//, 'src/')),
			type: 'sourceFile',
		};
	}
	if (
		(moduleName.startsWith('./') || moduleName.startsWith('../')) &&
		context.originModulePath &&
		context.originModulePath.startsWith(nipworkerRoot)
	) {
		return {
			filePath: resolveSourcePath(path.resolve(path.dirname(context.originModulePath), moduleName)),
			type: 'sourceFile',
		};
	}

	if (defaultResolveRequest) {
		return defaultResolveRequest(context, moduleName, platform);
	}

	return context.resolveRequest(context, moduleName, platform);
};
config.resolver.extraNodeModules = {
	...(config.resolver.extraNodeModules ?? {}),
	'@babel/runtime': path.resolve(__dirname, 'node_modules/@babel/runtime'),
	react: path.resolve(__dirname, 'node_modules/react'),
	'react-native': path.resolve(__dirname, 'node_modules/react-native')
};

module.exports = withNativeWind(config, { input: './global.css' });
