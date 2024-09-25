import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import child_process from 'node:child_process';
import iconv from 'iconv-lite';
import { convertXbiToFlash, detectExeType, extractFromExe, extractUpdaterFromExe, getXbiExtension, isXbi, parseXbi } from '@sie-js/fw';
import { sprintf } from 'sprintf-js';

export function normalizeModel(model) {
	return model.toUpperCase().replace(/i$/i, 'i');
}

export function detectContentType(buffer) {
	if (isXbi(buffer)) {
		let xbiInfo = parseXbi(buffer, true);
		return getXbiExtension(xbiInfo);
	} else if (buffer.subarray(0, 4).equals(Buffer.from("504B0304", "hex"))) {
		return 'zip';
	} else if (buffer.subarray(0, 13).equals(Buffer.from("[MapFileInfo]"))) {
		return 'map';
	} else {
		return 'bin';
	}
}

export function isSEA(file) {
	if (file == null)
		return false;
	let { stdout } = child_process.spawnSync("file", [file]);
	return /(RAR|ZIP) self-extracting/.test(stdout.toString());
}

function getDateFromXBI(xbi) {
	let reconfigureTime = parseDateFromXBI(xbi.reconfigureTime);
	let linkTime = parseDateFromXBI(xbi.linkTime);
	if (linkTime == null || reconfigureTime == null)
		return null;
	return Math.max(reconfigureTime, linkTime);
}

function parseDateFromXBI(date) {
	let parsed = date.match(/^(\d+)\.(\d+)\.(\d+) (\d+:\d+:\d+)$/);
	if (parsed) {
		let parsedDate = new Date(`20${parsed[3]}-${parsed[2]}-${parsed[1]}T${parsed[4]}`);
		console.log(parsedDate, date, '->', `20${parsed[3]}-${parsed[2]}-${parsed[1]}T${parsed[4]}`);
		return parsedDate.getTime();
	}
	return null;
}

export function compareXbis(a, b) {
	let xbiA = parseXbi(a, true);
	let xbiB = parseXbi(b, true);

	if (!xbiA || !xbiB)
		return null;

	if (xbiA.valid && !xbiB.valid) {
		return a;
	} else if (!xbiA.valid && xbiB.valid) {
		return b;
	}

	let xbiTimeA = getDateFromXBI(xbiA);
	let xbiTimeB = getDateFromXBI(xbiB);

	if (xbiTimeA > xbiTimeB) {
		return a;
	} else if (xbiTimeA < xbiTimeB) {
		return b;
	}

	let ffA = convertXbiToFlash(a);
	let ffB = convertXbiToFlash(b);

	if (!ffA || !ffB)
		return null;

	if (calcMD5(ffA) != calcMD5(ffB))
		return null;

	if (xbiA.eraseRegions.length == 2 && xbiB.eraseRegions.length == 1) {
		return a;
	} else if (xbiA.eraseRegions.length == 1 && xbiB.eraseRegions.length == 2) {
		return b;
	}

	console.log(xbiA, xbiB);

	fs.writeFileSync("/tmp/a.bin", a); // FIXME: remove
	fs.writeFileSync("/tmp/b.bin", b); // FIXME: remove

	return null;
}

export function compareUpdaters(a, b) {
	let exeTypeA = detectExeType(a);
	let exeTypeB = detectExeType(b);

	if (!exeTypeA || !exeTypeB)
		return null;

	if (exeTypeA !== exeTypeB)
		return null;

	let extractedFilesA = extractFromExe(a);
	let extractedFilesB = extractFromExe(b);

	if (!extractedFilesA || !extractedFilesB)
		return null;

	if (extractedFilesA.length !== extractedFilesB.length)
		return null;

	let updaterA = extractUpdaterFromExe(a);
	let updaterB = extractUpdaterFromExe(b);

	if (!updaterA || !updaterB)
		return null;

	let isChanged = false;
	let scoreA = 0;
	let scoreB = 0;

	for (let i = 0; i < extractedFilesA.length; i++) {
		if (calcMD5(extractedFilesA[i]) !== calcMD5(extractedFilesB[i])) {
			isChanged = true;
			if (isXbi(extractedFilesA[i])) {
				let xbiA = parseXbi(extractedFilesA[i], true);
				let xbiB = parseXbi(extractedFilesB[i], true);

				if (xbiA.valid && !xbiB.valid) {
					scoreA++;
				} else if (!xbiA.valid && xbiB.valid) {
					scoreB++;
				} else {
					return null;
				}
			} else {
				return null;
			}
		}
	}

	if (isChanged) {
		if (scoreA == scoreB)
			return null;
		return scoreA > scoreB ? a : b;
	}

	/*
	if (updaterA.length != updaterB.length)
		return null;

	let changedBytes = 0;
	for (let i = 0; i < updaterA.length; i++) {
		if (updaterA[i] != updaterB[i])
			changedBytes++;
	}

	if (changedBytes > 64)
		return null;
	*/

	let buildTimeA = getExeBuildTime(a);
	let buildTimeB = getExeBuildTime(b);

	let allsiemensA = a.indexOf('allsiemens.com') >= 0;
	let allsiemensB = b.indexOf('allsiemens.com') >= 0;

	if (allsiemensA && !allsiemensB) {
		return b;
	} else if (allsiemensB && !allsiemensA) {
		return a;
	} else {
		return buildTimeA >= buildTimeB ? a : b;
	}
}

export function compareMaps(a, b) {
	if (detectContentType(a) != 'map' || detectContentType(b) != 'map')
		return null;
	if (a.toString().trim() == b.toString().trim())
		return a.length <= b.length ? a : b;

	let mapTimeA = getTimeFromMap(a.toString());
	let mapTimeB = getTimeFromMap(b.toString());

	if (mapTimeA != null && mapTimeB != null) {
		if (mapTimeA > mapTimeB) {
			return a;
		} else if (mapTimeA < mapTimeB) {
			return b;
		}
	}

	return null;
}

function getTimeFromMap(map) {
	let mapTime = map.match(/^Time\s*=\s*(\d{2})(\d{2})(\d{2})\s*$/mi);
	let mapDate = map.match(/^Date\s*=\s*(\d{2})(\d{2})(\d{2})\s*$/mi);
	if (mapTime && mapDate) {
		let timestamp = new Date(`20${mapDate[1]}-${mapDate[2]}-${mapDate[3]}T${mapTime[1]}:${mapTime[2]}:${mapTime[3]}`);
		return timestamp.getTime();
	}
	return null;
}

function getExeBuildTime(buffer) {
	let peHeaderOffset = buffer.readUInt32LE(0x3C);
	if (peHeaderOffset + 32 < buffer.length && buffer.readUInt32LE(peHeaderOffset) != 0x00004550)
		throw new Error(`Invalid PE file!`);
	return buffer.readUInt32LE(peHeaderOffset + 8);
}

export function parseByName(name) {
	name = path.basename(name).replace(/_2D/g, '-');

	let m;
	if ((m = name.match(/^([a-z0-9]+)_(\d+)_([\w\d_-]+)_(\d+)_(\d+)\.zip/i))) {
		return {
			file: "ffs",
			model: normalizeModel(m[1]),
			order: +m[2],
			retail: m[3],
			svn: +m[4],
			variant: m[5],
			toString() {
				return [
					this.model,
					this.order,
					this.retail,
					sprintf("%02d", this.svn),
					this.variant
				].join("_") + ".zip";
			}
		};
	} else if ((m = name.match(/FFSInit_([a-z0-9]+)_(\d+)_([\w\d_-]+)_(\d+)_(\d+)\.exe$/i))) {
		return {
			file: "ffs",
			model: normalizeModel(m[1]),
			order: +m[2],
			retail: m[3],
			svn: +m[4],
			variant: m[5],
			toString() {
				return [
					"FFSInit",
					this.model,
					this.order,
					this.retail,
					sprintf("%02d", this.svn),
					this.variant
				].join("_") + ".exe";
			}
		};
	} else if ((m = name.match(/^([a-z0-9]+)_(\d+)_([\w\d_-]+)_(\d+)_(\d+)(\.map|\.map\.txt|_map\.txt|\.txt)$/i))) {
		return {
			file: "map",
			model: normalizeModel(m[1]),
			order: +m[2],
			retail: m[3],
			svn: +m[4],
			variant: m[5],
			toString() {
				return [
					this.model,
					this.order,
					this.retail,
					sprintf("%02d", this.svn),
					this.variant
				].join("_") + ".map";
			}
		};
	} else if ((m = name.match(/^([a-z0-9]+)_(\d+)_([\w\d_-]+)_(\d+)_(\d+)\.map\.exe$/i))) {
		return {
			file: "map",
			model: normalizeModel(m[1]),
			order: +m[2],
			retail: m[3],
			svn: +m[4],
			variant: m[5],
			toString() {
				return [
					this.model,
					this.order,
					this.retail,
					sprintf("%02d", this.svn),
					this.variant
				].join("_") + ".map.exe";
			}
		};
	} else if ((m = name.match(/^(SX1|SX1C)_([\w\d_-]+)_(\d+)_(\d+)(?:_(service|update|signed))?\.exe$/i))) {
		return {
			file: "fw",
			model: normalizeModel(m[1]),
			retail: m[2],
			svn: +m[3],
			variant: m[4],
			postfix: m[5],
			toString() {
				return [
					this.model,
					this.retail,
					sprintf("%02d", this.svn),
					this.variant,
					this.postfix
				].filter((v) => v != null && String(v).length > 0).join("_") + ".exe";
			}
		};
	} else if ((m = name.match(/^(A38|AP75|CF61|CL71)_FW_[V]?([\d.]+)_(.*?).zip$/i))) {
		return {
			file: "fw",
			model: normalizeModel(m[1]),
			svn: m[2],
			retail: m[3],
			toString() {
				return [
					this.model,
					'FW',
					`v${this.svn}`,
					this.retail,
				].join("_") + ".zip";
			}
		};
	} else if ((m = name.match(/^(SF71)_SVN(\d+)_(.*?)\.exe$/i))) {
		return {
			file: "fw",
			model: normalizeModel(m[1]),
			svn: +m[2],
			retail: m[3],
			toString() {
				return [
					this.model,
					sprintf("SVN%02d", this.svn),
					this.retail,
				].join("_") + ".exe";
			}
		};
	} else if ((m = name.match(/^(M7)_SVN(\d+)_(.*?)\.exe$/i))) {
		return {
			file: "fw",
			model: normalizeModel(m[1]),
			svn: +m[2],
			retail: m[3],
			toString() {
				return [
					this.model,
					sprintf("SVN%02d", this.svn),
					this.retail,
				].join("_") + ".exe";
			}
		};
	} else if ((m = name.match(/^MCSDTOOL_(A38)_.*?.exe$/i))) {
		return {
			file: "other",
			model: normalizeModel(m[1]),
			name: m[0],
			toString() {
				return this.name;
			}
		};
	} else if ((m = name.match(/^([a-z0-9]+)_mmccontent(?:_(.*?))?\.(zip|rar|exe)$/i))) {
		return {
			file: "other",
			model: normalizeModel(m[1]),
			type: m[2]?.toLowerCase(),
			ext: m[3].toLowerCase(),
			toString() {
				return [this.model, 'mmccontent', this.type].filter((v) => v != null && String(v).length > 0).join("_") + "." + this.ext;
			}
		};
	} else if ((m = name.match(/^Langpack_lg\d+_([a-z0-9]+)_v\d+(?:_[a-f0-9]+)?.(?:fbk|bin)$/i))) {
		return {
			file: "other",
			model: normalizeModel(m[1]),
			name: m[0],
			toString() {
				return this.name;
			}
		};
	} else if ((m = name.match(/^([a-z0-9]+)_FFS(\.|_.*?\.)(rar|zip)$/i))) {
		return {
			file: "other",
			model: normalizeModel(m[1]),
			name: m[0],
			toString() {
				return this.name;
			}
		};
	}

	/*
	else if ((m = name.match(/^([a-z0-9]+)_SVN(\d+)_([a-z0-9-]+_\d+_\d+)\.exe$/i))) {
		return {
			file: "fw",
			model: m[1].toUpperCase(),
			svn: +m[2],
			retail: m[3],
			toString() {
				return [
					this.model,
					sprintf("SVN%02d", this.svn),
					this.retail,
				].filter((v) => v != null && String(v).length > 0).join("_") + ".exe";
			}
		};
	} else if ((m = name.match(/^([a-z0-9]+)_([\w\d_-]+)_(\d+)_(\d+)(?:_(service|update))?\.exe$/i))) {
		return {
			file: "fw",
			model: m[1].toUpperCase(),
			order: 1,
			retail: m[2],
			svn: +m[3],
			variant: m[4],
			type: m[5],
			toString() {
				return [
					this.model,
					this.retail,
					sprintf("%02d", this.svn),
					this.variant,
					this.type
				].filter((v) => v != null && String(v).length > 0).join("_") + ".exe";
			}
		};
	}
	*/
	else if ((m = name.match(/^([a-z0-9]+)_(\d+)_([\w\d_-]+)_(\d+)_(\d+)(?:_(sig))?\.xfs/i))) {
		return {
			file: "ffs",
			model: normalizeModel(m[1]),
			order: +m[2],
			retail: m[3],
			svn: +m[4],
			variant: m[5],
			postfix: m[6],
			toString() {
				return [
					this.model,
					this.order,
					this.retail,
					sprintf("%02d", this.svn),
					this.variant,
					this.postfix
				].filter((v) => v != null && String(v).length > 0).join("_") + ".xfs";
			}
		};
	}
}

export function readFiles(dir, base, files) {
	base = base || "";
	files = files || [];
	fs.readdirSync(dir, {withFileTypes: true}).forEach((entry) => {
		if (entry.isDirectory()) {
			readFiles(dir + "/" + entry.name, base + entry.name + "/", files);
		} else {
			files.push(base + entry.name);
		}
	});
	return files;
}

export async function getFilesFromArchive(file) {
	return new Promise((resolve, reject) => {
		let proc = child_process.spawn("lsar", ["-ja", file], { encoding: 'utf-8' });
		let json = "";
		proc.stdout.on('data', (chunk) => json += chunk);
		proc.on('error', (e) => reject(e));
		proc.on('close', (status) => {
			try {
				if (status != 0)
					throw new Error(`Invalid archive [status=${status}]: ${file}`);
				resolve(JSON.parse(json));
			} catch (e) {
				reject(e);
			}
			proc = json = null;
		});
	});
}

export function extractFileFromArchive(file, index) {
	return new Promise((resolve, reject) => {
		let proc = child_process.spawn("unar", ["-i", "-o", "-", file, index]);
		let buffer = [];
		proc.stdout.on('data', (chunk) => buffer.push(chunk));
		proc.on('error', (e) => reject(e));
		proc.on('close', (status) => {
			try {
				if (status != 0)
					throw new Error(`Invalid archive [status=${status}]: ${file}`);
				resolve(Buffer.concat(buffer));
			} catch (e) {
				reject(e);
			}
			proc = buffer = null;
		});
	});
}

export function calcMD5(buffer) {
	return crypto.createHash('md5').update(buffer).digest('hex').toString();
}
