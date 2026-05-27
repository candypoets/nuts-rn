const path = require('path');

const nipworkerRoot = path.resolve(__dirname, '../nipworker');

module.exports = {
	dependencies: {
		'@candypoets/nipworker': {
			root: nipworkerRoot
		}
	}
};
