import fs from 'node:fs';
import path from 'node:path';

let model2hwid = {};

let files = readFiles("/media/azq2");
for (let file of files) {
	if (!file.match(/\.map$/i))
		continue;

	let m;
	let mapText = fs.readFileSync(file).toString();
	if (!(m = mapText.match(/^Product\s*=\s*(\d+)/mi))) {
		console.error(mapText);
		throw new Error(`Invalid map file: ${file}`);
	}

	let hwid = m[1];

	if (!(m = path.basename(file).match(/^([a-z0-9]+)_(\d+)_([\w\d_-]+)_(\d+)_(\d+)\.map$/i)))
		throw new Error(`Invalid map file: ${file}`);

	let model = m[1];
	console.log(model + "," + hwid);
}

function readFiles(dir, files = null) {
	files = files ?? [];
	fs.readdirSync(dir, {withFileTypes: true}).forEach((entry) => {
		if (entry.isDirectory()) {
			readFiles(dir + "/" + entry.name, files);
		} else {
			files.push(dir + "/" + entry.name);
		}
	});
	return files;
}
