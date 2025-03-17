import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import child_process from 'node:child_process';
import {
	convertXbiToFlash,
	detectExeType,
	extractFromExe,
	extractUpdaterFromExe,
	getXbiExtension,
	isXbi,
	parseXbi,
	XbiInfo
} from '@sie-js/fw';
import { sprintf } from 'sprintf-js';

export type XADEntry = {
	XADFileName: string;
	XADIndex: number;
	XADIsDirectory: boolean;
	XADIsEncrypted: number;
	XADFileSize: number;
};

export type XADProperties = {
	XADIsEncrypted: number;
	XADVolumes: string[];
	XADArchiveName: string;
};

export type XADArchive = {
	lsarContents: XADEntry[];
	lsarEncoding: string;
	lsarConfidence: number;
	lsarFormatName: string;
	lsarProperties: XADProperties;
};

export type ParsedName = {
	category: string;
	model: string;
	order?: number;
	retail?: string;
	svn?: number;
	variant?: string;
	type?: string;
	name?: string;
	ext?: string;
	postfix?: string;
	toString: () => string;
};

export class RecoverableError extends Error {

}

export function isUserSwup(xbi: XbiInfo): boolean {
	return xbi.databaseName == 'projects' || xbi.baseline == 'PV_bin2swp_V0.0' || xbi.baselineRelease == 'PapuaSoft_and_PapuaHard';

}

export async function isFFSArchive(blobPath: string): Promise<[isFFS: boolean, shouldWarn: boolean]> {
	let archive: XADArchive | undefined;
	try { archive = await getFilesFromArchive(blobPath); } catch (e) { }
	if (archive) {
		for (const file of archive.lsarContents) {
			if (file.XADFileName.match(/\/(ccq_vinfo\.txt|ccq_chk\.log|graphcach|_cleargc|profile\.pd)$/i))
				return [true, false];
		}
		return [false, archive.lsarContents.length >= 10];
	}
	return [false, true];
}

export async function getVersionFromZIP(tmpFile: string): Promise<string | undefined> {
	if (!await isFFSArchive(tmpFile))
		return undefined;

	const archive = await getFilesFromArchive(tmpFile);
	for (const file of archive.lsarContents) {
		if (file.XADFileName.toLowerCase() == 'config/ccq_vinfo.txt') {
			const lines = (await extractFileFromArchive(tmpFile, file.XADIndex)).toString().split(/\r\n|\n/);
			if (lines.length >= 2)
				return lines[0].trim();
		}
	}
	return undefined;
}

export function normalizeModel(model: string): string {
	return model.toUpperCase()
		.replace(/([ix])$/i, '$1') // SL45i, C3x
		.replace(/v(\d+)$/i, 'v$1') // C25v4
		.replace(/([A-Z]+[0-9])I$/i, '$1I'); // C3I
}

export function detectContentType(buffer: Buffer): string {
	if (isXbi(buffer)) {
		const xbi = parseXbi(buffer, true);
		if (!xbi)
			throw new Error(`Can't parse XBI!`);
		return getXbiExtension(xbi);
	} else if (buffer.subarray(0, 4).equals(Buffer.from("504B0304", "hex"))) {
		return 'zip';
	} else if (buffer.subarray(0, 13).equals(Buffer.from("[MapFileInfo]"))) {
		return 'map';
	} else if (buffer.subarray(0, 2).equals(Buffer.from("MZ"))) {
		const extracted = extractFromExe(buffer);
		if (extracted)
			return detectContentType(extracted[0]) + ".exe";
		return 'bin';
	} else {
		return 'bin';
	}
}

export function isSEA(file: string | undefined): boolean {
	if (file == null)
		return false;
	const { stdout } = child_process.spawnSync("file", [file]);
	return /(RAR|ZIP) self-extracting/.test(stdout.toString());
}

export function isMSDOS(file: string | undefined): boolean {
	if (file == null)
		return false;
	const { stdout } = child_process.spawnSync("file", [file]);
	return /MS-DOS/.test(stdout.toString());
}

function parseDateFromXBI(date: string): number | undefined {
	const parsed = date.match(/^(\d+)\.(\d+)\.(\d+) (\d+:\d+:\d+)$/);
	if (parsed) {
		const year = +parsed[3] >= 90 ? `19${parsed[3]}` : `20${parsed[3]}`;
		const parsedDate = new Date(`${year}-${parsed[2]}-${parsed[1]}T${parsed[4]}`);
		return parsedDate.getTime();
	}
	return undefined;
}

function getDateFromXBI(xbi: XbiInfo): number {
	if (xbi.reconfigureTime == null || xbi.linkTime == null)
		throw new Error(`Not reconfigureTime/linkTime in XBI!`);
	const reconfigureTime = parseDateFromXBI(xbi.reconfigureTime);
	const linkTime = parseDateFromXBI(xbi.linkTime);
	if (linkTime == null || reconfigureTime == null)
		throw new Error(`Invalid reconfigureTime/linkTime in XBI!`);
	return Math.max(reconfigureTime, linkTime);
}

export function compareXbis(a: Buffer, b: Buffer): Buffer | undefined {
	const xbiA = parseXbi(a, true);
	const xbiB = parseXbi(b, true);

	if (!xbiA || !xbiB)
		return undefined;

	if (xbiA.size == xbiA.size && a.length != b.length) {
		if (calcMD5(a.subarray(0, xbiA.size)) === calcMD5(b.subarray(0, xbiB.size)))
			return a.length < b.length ? a : b;
	}

	if (xbiA.valid && !xbiB.valid) {
		return a;
	} else if (!xbiA.valid && xbiB.valid) {
		return b;
	}

	const xbiTimeA = getDateFromXBI(xbiA);
	const xbiTimeB = getDateFromXBI(xbiB);

	if (xbiTimeA > xbiTimeB) {
		return a;
	} else if (xbiTimeA < xbiTimeB) {
		return b;
	}

	fs.writeFileSync("/tmp/a.bin", a); // FIXME: remove
	fs.writeFileSync("/tmp/b.bin", b); // FIXME: remove

	const ffA = convertXbiToFlash(a);
	const ffB = convertXbiToFlash(b);

	if (!ffA || !ffB)
		return undefined;

	if (calcMD5(ffA) != calcMD5(ffB))
		return undefined;

	if (xbiA.eraseRegions != null && xbiB.eraseRegions != null) {
		if (xbiA.eraseRegions.length == 2 && xbiB.eraseRegions.length == 1) {
			return a;
		} else if (xbiA.eraseRegions.length == 1 && xbiB.eraseRegions.length == 2) {
			return b;
		}
	}

	console.log(xbiA, xbiB);

	return undefined;
}

export function isBFB95EGValid(data: Buffer) {
	return data.indexOf(Buffer.from("BFB_Library")) > 0;
}

export function compareBFB95EG(a: Buffer, b: Buffer): Buffer | undefined {
	const buildTimeA = getExeBuildTime(a);
	const buildTimeB = getExeBuildTime(b);

	if (buildTimeA == buildTimeB)
		return undefined;

	return buildTimeA >= buildTimeB ? a : b;
}

export function compareUpdaters(a: Buffer, b: Buffer): Buffer | undefined {
	const exeTypeA = detectExeType(a);
	const exeTypeB = detectExeType(b);

	if (!exeTypeA && exeTypeB) {
		if (a.length < 1024 * 1024)
			return b;
	}

	if (exeTypeA && !exeTypeB) {
		if (b.length < 1024 * 1024)
			return a;
	}

	if (!exeTypeA || !exeTypeB)
		return undefined;

	if (exeTypeA !== exeTypeB)
		return undefined;

	const extractedFilesA = extractFromExe(a);
	const extractedFilesB = extractFromExe(b);

	if (!extractedFilesA || !extractedFilesB)
		return undefined;

	if (extractedFilesA.length !== extractedFilesB.length)
		return undefined;

	const updaterA = extractUpdaterFromExe(a);
	const updaterB = extractUpdaterFromExe(b);

	if (!updaterA || !updaterB)
		return undefined;

	let isChanged = false;
	let scoreA = 0;
	let scoreB = 0;

	for (let i = 0; i < extractedFilesA.length; i++) {
		if (calcMD5(extractedFilesA[i]) !== calcMD5(extractedFilesB[i])) {
			isChanged = true;
			if (isXbi(extractedFilesA[i])) {
				const xbiA = parseXbi(extractedFilesA[i], true);
				const xbiB = parseXbi(extractedFilesB[i], true);

				if (!xbiA || !xbiB)
					throw new Error(`Can't parse XBI!`);

				if (xbiA.valid && !xbiB.valid) {
					scoreA++;
				} else if (!xbiA.valid && xbiB.valid) {
					scoreB++;
				} else {
					return undefined;
				}
			} else {
				return undefined;
			}
		}
	}

	if (isChanged) {
		if (scoreA == scoreB)
			return undefined;
		return scoreA > scoreB ? a : b;
	}

	/*
	if (updaterA.length != updaterB.length)
		return undefined;

	let changedBytes = 0;
	for (const i = 0; i < updaterA.length; i++) {
		if (updaterA[i] != updaterB[i])
			changedBytes++;
	}

	if (changedBytes > 64)
		return undefined;
	*/

	const buildTimeA = getExeBuildTime(a);
	const buildTimeB = getExeBuildTime(b);

	const allsiemensA = a.indexOf('allsiemens.com') >= 0;
	const allsiemensB = b.indexOf('allsiemens.com') >= 0;

	if (allsiemensA && !allsiemensB) {
		return b;
	} else if (allsiemensB && !allsiemensA) {
		return a;
	} else {
		return buildTimeA >= buildTimeB ? a : b;
	}
}

export function compareMaps(a: Buffer, b: Buffer): Buffer | undefined {
	if (detectContentType(a) != 'map' || detectContentType(b) != 'map')
		return undefined;
	if (a.toString().trim() == b.toString().trim())
		return a.length <= b.length ? a : b;

	const mapTimeA = getTimeFromMap(a.toString());
	const mapTimeB = getTimeFromMap(b.toString());

	if (mapTimeA != null && mapTimeB != null) {
		if (mapTimeA > mapTimeB) {
			return a;
		} else if (mapTimeA < mapTimeB) {
			return b;
		}
	}

	return undefined;
}

function getTimeFromMap(map: string): number | undefined {
	const mapTime = map.match(/^Time\s*=\s*(\d{2})(\d{2})(\d{2})\s*$/mi);
	const mapDate = map.match(/^Date\s*=\s*(\d{2})(\d{2})(\d{2})\s*$/mi);
	if (mapTime && mapDate) {
		const timestamp = new Date(`20${mapDate[1]}-${mapDate[2]}-${mapDate[3]}T${mapTime[1]}:${mapTime[2]}:${mapTime[3]}`);
		return timestamp.getTime();
	}
	return undefined;
}

function getExeBuildTime(buffer: Buffer): number {
	const peHeaderOffset = buffer.readUInt32LE(0x3C);
	if (peHeaderOffset + 32 < buffer.length && buffer.readUInt32LE(peHeaderOffset) != 0x00004550)
		throw new Error(`Invalid PE file!`);
	return buffer.readUInt32LE(peHeaderOffset + 8);
}

export function parseByName(name: string): ParsedName | undefined {
	name = path.basename(name).replace(/_2D/g, '-');

	let m: RegExpMatchArray | null;
	if ((m = name.match(/^([a-z0-9]+)_(\d+)_([\w_-]+)_(\d+)_(\d+)\.zip/i))) {
		return {
			category: "ffs",
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
	} else if ((m = name.match(/FFSInit_([a-z0-9]+)_(\d+)_([\w_-]+)_(\d+)_(\d+)\.exe$/i))) {
		return {
			category: "ffs",
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
	} else if ((m = name.match(/^(?:MobileMap_)?([a-z0-9]+)_(\d+)_([\w_-]+)_(\d+)_(\d+)(?:\s*\(\d+\))?(\.map|\.map\.txt|_map\.txt|\.txt|\.exe|\.map\.exe)$/i))) {
		if (/^([0-9_]+)\.txt$/i.test(name))
			return undefined;

		const isExe = name.match(/\.exe$/i);

		return {
			category: "map",
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
				].join("_") + (isExe ? ".map.exe" : ".map");
			}
		};
	} else if ((m = name.match(/^([a-z0-9]+)_mmccontent(?:_(.*?))?\.(zip|rar|exe)$/i))) {
		return {
			category: "other",
			model: normalizeModel(m[1]),
			type: m[2]?.toLowerCase(),
			ext: m[3].toLowerCase(),
			toString() {
				return [this.model, 'mmccontent', this.type].filter((v) => v != null && String(v).length > 0).join("_") + "." + this.ext;
			}
		};
	} else if ((m = name.match(/^Langpack_lg\d+_([a-z0-9]+)_v\d+(?:_[a-f0-9]+)?.(?:fbk|bin)$/i))) {
		return {
			category: "other",
			model: normalizeModel(m[1]),
			name: m[0],
			toString() {
				return this.name!;
			}
		};
	} else if ((m = name.match(/^([a-z0-9]+)_FFS(\.|_.*?\.)(rar|zip)$/i))) {
		return {
			category: "other",
			model: normalizeModel(m[1]),
			name: m[0],
			toString() {
				return this.name!;
			}
		};
	} else if ((m = name.match(/^([a-z0-9]+)_(\d+)_([\w_-]+)_(\d+)_(\d+)(?:_(sig))?(?:\s*\(\d+\))?\.xfs$/i))) {
		return {
			category: "ffs",
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
	} else if ((m = name.match(/^(.*?)_?(\d\d)(?:\s*\(\d+\))?\.xbb$/i))) {
		return {
			category: "bcore",
			model: normalizeModel(m[1]),
			svn: +m[2],
			toString() {
				return [
					this.model,
					sprintf("%02d", this.svn),
				].filter((v) => v != null && String(v).length > 0).join("_") + ".xbb";
			}
		};
	} else if ((m = name.match(/^(.*?)t9[a-z]{2}\d+\.xbi$/i))) {
		return {
			category: "userswup",
			model: normalizeModel(m[1]),
			name: m[0],
			toString() {
				return this.name!;
			}
		};
	}


}

export function readFiles(dir: string, base: string = "", files: string[] = []) {
	fs.readdirSync(dir, {withFileTypes: true}).forEach((entry) => {
		if (entry.isDirectory()) {
			readFiles(dir + "/" + entry.name, base + entry.name + "/", files);
		} else {
			files.push(base + entry.name);
		}
	});
	return files;
}

export async function getFilesFromArchive(file: string): Promise<XADArchive> {
	return new Promise<XADArchive>((resolve, reject) => {
		const proc = child_process.spawn("lsar", ["-ja", file]);
		const buffer: Buffer[] = [];
		proc.stdout.on('data', (chunk) => buffer.push(chunk));
		proc.on('error', (e) => reject(e));
		proc.on('close', (status) => {
			try {
				const json = JSON.parse(Buffer.concat(buffer).toString()) as XADArchive;
				if (json.lsarContents == null || json.lsarProperties == null)
					throw new RecoverableError(`Invalid archive [status=${status}]`);
				resolve(json);
			} catch (e) {
				if (!(e instanceof RecoverableError)) {
					reject(new RecoverableError(`Invalid archive [status=${status}]`));
				} else {
					reject(e);
				}
			}
		});
	});
}

export async function extractFileFromArchive(file: string, index: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const proc = child_process.spawn("unar", ["-i", "-o", "-", file, index.toString()]);
		const buffer: Buffer[] = [];
		proc.stdout.on('data', (chunk) => buffer.push(chunk));
		proc.on('error', (e) => reject(e));
		proc.on('close', (status) => {
			try {
				if (status != 0)
					throw new RecoverableError(`Invalid archive [status=${status}]`);
				resolve(Buffer.concat(buffer));
			} catch (e) {
				reject(e);
			}
		});
	});
}

export function calcMD5(buffer: Buffer | string): string {
	return crypto.createHash('md5').update(buffer).digest('hex').toString();
}
