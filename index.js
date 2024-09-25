import fs, { unlink } from 'node:fs';
import path from 'node:path';
import { sprintf } from 'sprintf-js';
import { parseByName } from './src/utils.js';

let list = {};

let files = fs.readFileSync("files.txt").toString().split("\n");
for (let file of files) {
	if (!file.match(/\.(xbi|xbi|xbb|xfs|exci|exbi|exe|map)$/i)) {
		continue;
	}

	let fileNameParts = file.split(' -> ');
	let name = path.basename(fileNameParts[fileNameParts.length - 1]);

	let parsed = parseByName(name);
	if (parsed) {
		//console.log(parsed);
		list[parsed.model] = list[parsed.model] || {};
		list[parsed.model][parsed.svn] = list[parsed.model][parsed.svn] || {};
		list[parsed.model][parsed.svn][parsed.file] = list[parsed.model][parsed.svn][parsed.file] || [];

		if (!list[parsed.model][parsed.svn][parsed.file].includes(name))
			list[parsed.model][parsed.svn][parsed.file].push(name);

//		if (name.toLowerCase() != parsed.toString().toLowerCase())
//			console.log(name, '->', parsed.toString());
	} else {
		console.log(name);
	}
}

//console.log(list);
