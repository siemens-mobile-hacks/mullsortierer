import fs from 'node:fs';
import path from 'node:path';

const FW_DIRS_FILTER = [
	'/home/azq2/Downloads/s/Service Siemens/прошивки/',
	'/home/azq2/Downloads/s/siemensfw.kibab.com/FW_SOLD/',
	'/home/azq2/Downloads/s/Siemens/SIEMENS FIRMWARE/',
	'/home/azq2/Downloads/s/mail.ru/sgold/'
];

const FW_FILES_FILTER = [
	'GSM-MULTIFUND feat. HANDYHACKING.txt',
	'bfb95eg.DLL',
	'ReadMe.txt',
	'gsm-multifund.de.txt',
	'use winswup 418',
	'SWUPINST.EXE',
	'README.TXT',
	'LIESMICH.TXT',
	'XBZ_use_Winswup_3.08_for_this phone.txt',
	'XBZ_use_Winswup_3.10_for_this_phone.txt',
	'WinSwup_3.08.exe',
	'WinSwup_3.10.exe',
	'info.txt',
	'swup193.exe'
].map((v) => v.toLowerCase());

let allFiles = JSON.parse(fs.readFileSync("all_files.json"));
let savedFiles = JSON.parse(fs.readFileSync("saved_files.json"));
allFiles = allFiles.map((fileName) => fileName.replace(/ -> /g, '/').replace(/[\/]+/g, '/'));

let usedFilesHash = {};
for (let fileName of Object.keys(savedFiles)) {
	usedFilesHash[fileName.replace(/ -> /g, '/').replace(/[\/]+/g, '/')] = true;
}

let total = 0;
let filesTree = {};
for (let fileName of allFiles) {
	let ref = filesTree;

	let found = false;
	for (let f of FW_DIRS_FILTER) {
		if (fileName.indexOf(f) == 0) {
			found = true;
			break;
		}
	}

	if (!found)
		continue;

	total++;

	for (let filePart of fileName.replace(/^\/|\/$/, '').split('/')) {
		ref[filePart] = ref[filePart] || {};
		ref = ref[filePart];
	}
}

console.log('total=' + total);

let html = "";
html += walkTree(filesTree);

fs.writeFileSync("/tmp/1.html", htmlPage(html));

function walkTree(tree, nameParts = []) {
	let html = "";
	let level = nameParts.length;
	for (let k in tree) {
		let fileName = '/' + [...nameParts, k].join('/');
		if (usedFilesHash[fileName])
			continue;

		if (FW_FILES_FILTER.indexOf(path.basename(fileName).toLowerCase()) >= 0)
			continue;

		if (Object.keys(tree[k]).length) {
			let sub = walkTree(tree[k], [...nameParts, k]);
			if (sub.length) {
				html += `
					<div class="dir ${usedFilesHash[fileName] ? 'dir--is-used' : ''}">
						${"&nbsp;&nbsp;&nbsp;&nbsp;".repeat(level)}📁${k}:
					</div>
				`;
				html += sub;
			}
		} else {
			console.log(fileName);
			html += `
				<div class="file ${usedFilesHash[fileName] ? 'file--is-used' : ''}">
					${"&nbsp;&nbsp;&nbsp;&nbsp;".repeat(level)}📎${k}
				</div>
			`;
		}
	}
	return html;
}

function htmlPage(content) {
	return `<!DOCTYPE html>
<html>
	<head>
	<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />
	<title>?</title>

	<style>
		body {
			background: #fff;
		}

		.file {
			color: darkred;
		}

		.dir {
			color: grey;
		}

		.file--is-used, .dir--is-used {
			color: lightgrey;
			font-weight: bold;
		}

	</style>
	</head>

	<body>
		${content}
	</body>
</html>
`;
}
