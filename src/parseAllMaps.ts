import { extractFromExe, HWID, parseXbi, XbiInfo } from '@sie-js/fw';
import fs from 'node:fs';
import path from 'node:path';
import { detectContentType } from './utils.js';
import { markdownTable } from "markdown-table";

const modelToHwidMAP: Record<string, string[]> = {};
const hwidToModelMAP: Record<string, string[]> = {};

const modelToHwidXBI: Record<string, string[]> = {};
const hwidToModelXBI: Record<string, string[]> = {};

const modelToHwidALL: Record<string, string[]> = {};
const hwidToModelALL: Record<string, string[]> = {};

const allXbiModels: string[] = [];

for (const file of readFiles("/media/azq2/backup2/fw")) {
	let model: string;
	let hwid: number;
	let hwidName: string;

	if (file.indexOf('userswup') >= 0)
		continue;

	if (file.match(/\.map$/i)) {
		if (file.indexOf("nodelta") >= 0)
			continue;

		let m;
		const mapText = fs.readFileSync(file).toString();
		if (!(m = mapText.match(/^Product\s*=\s*(\d+)/mi))) {
			console.error(`Invalid map file: ${file}`);
			continue;
		}
		hwid = +m[1];
		hwidName = HWID[hwid] ? HWID[hwid] + ":" + hwid.toString() : hwid.toString();

		if (!(m = path.basename(file).match(/^([a-z0-9]+)_(\d+)_([\w\d_-]+)_(\d+)_(\d+)\.map$/i))) {
			console.error(`Invalid map file: ${file}`);
			continue;
		}
		model = m[1].toUpperCase();

		if (!modelToHwidMAP[model])
			modelToHwidMAP[model] = [];
		if (!hwidToModelMAP[hwidName])
			hwidToModelMAP[hwidName] = [];

		if (!modelToHwidMAP[model].includes(hwidName))
			modelToHwidMAP[model].push(hwidName);
		if (!hwidToModelMAP[hwidName].includes(model))
			hwidToModelMAP[hwidName].push(model);

		if (!modelToHwidALL[model])
			modelToHwidALL[model] = [];
		if (!hwidToModelALL[hwidName])
			hwidToModelALL[hwidName] = [];

		if (!modelToHwidALL[model].includes(hwidName))
			modelToHwidALL[model].push(hwidName);
		if (!hwidToModelALL[hwidName].includes(model))
			hwidToModelALL[hwidName].push(model);
	} else if (file.match(/\.exe$/i) || file.match(/\.(xbz|xbi)$/i)) {
		let xbiInfo: XbiInfo | undefined;
		if (file.match(/\.exe$/i)) {
			const extracted = extractFromExe(fs.readFileSync(file));
			if (!extracted)
				continue;

			xbiInfo = parseXbi(extracted[0], true);
			if (!xbiInfo) {
				if (detectContentType(extracted[0]) == "xbi")
					console.error(`Invalid xbi file: ${file}`);
				continue;
			}
		} else {
			xbiInfo = parseXbi(fs.readFileSync(file), true);
			if (!xbiInfo) {
				console.error(`Invalid xbi file: ${file}`);
				continue;
			}
		}

		if (!xbiInfo.model) {
			console.error(`No model: ${file}`);
			continue;
		}

		if (!allXbiModels.includes(xbiInfo.model))
			allXbiModels.push(xbiInfo.model);

		if (!xbiInfo.hwid || xbiInfo.hwid == 0xFFFF) {
			console.error(`No hwid: ${file}`);
			continue;
		}

		model = xbiInfo.model.toUpperCase();
		hwid = xbiInfo.hwid;
		hwidName = HWID[hwid] ? HWID[hwid] + ":" + hwid.toString() : hwid.toString();

		if (!modelToHwidXBI[model])
			modelToHwidXBI[model] = [];
		if (!hwidToModelXBI[hwidName])
			hwidToModelXBI[hwidName] = [];

		if (!modelToHwidXBI[model].includes(hwidName))
			modelToHwidXBI[model].push(hwidName);
		if (!hwidToModelXBI[hwidName].includes(model))
			hwidToModelXBI[hwidName].push(model);

		if (!modelToHwidALL[model])
			modelToHwidALL[model] = [];
		if (!hwidToModelALL[hwidName])
			hwidToModelALL[hwidName] = [];

		if (!modelToHwidALL[model].includes(hwidName))
			modelToHwidALL[model].push(hwidName);
		if (!hwidToModelALL[hwidName].includes(model))
			hwidToModelALL[hwidName].push(model);
	}
}

console.log("**MODEL vs HWID**");
const modelToHwidTable = [["Model", "HWID's"]];
for (const [model, hwidList] of Object.entries(modelToHwidALL)) {
	modelToHwidTable.push([model, hwidList.join(", ")]);
}
console.log(markdownTable(modelToHwidTable));

console.log("**HWID vs MODEL**");
const hwidToModelTable = [["HWID", "Models"]];
for (const [hwid, models] of Object.entries(hwidToModelALL)) {
	hwidToModelTable.push([hwid, models.join(", ")]);
}
console.log(markdownTable(hwidToModelTable));

/*
console.log("");
console.log("XBI");
console.log(modelToHwidXBI);
console.log(hwidToModelXBI);

console.log("");
console.log("MAP");
console.log(modelToHwidMAP);
console.log(hwidToModelMAP);

console.log("");
console.log("ALL");
console.log(modelToHwidALL);
console.log(hwidToModelALL);
*/

function readFiles(dir: string, files: string[] = []): string[] {
	fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
		if (entry.isDirectory()) {
			readFiles(dir + "/" + entry.name, files);
		} else {
			files.push(dir + "/" + entry.name);
		}
	});
	return files;
}
