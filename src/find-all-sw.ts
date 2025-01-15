import "./console-colors.js";
import fs from 'node:fs';
import path from 'node:path';
import {
	calcMD5,
	parseByName, detectContentType,
    normalizeModel,
    isSEA,
    compareUpdaters,
    compareMaps,
    compareXbis,
    isFFSArchive,
    isUserSwup,
    getVersionFromZIP,
    isMSDOS,
    compareBFB95EG,
    isBFB95EGValid,
    RecoverableError
} from './utils.js';
import { convertXbiToFlash, detectExeType, detectServiceExeFormatVersion, extractFromExe, getVersionFromFFS, getXbiExtension, isXbi, parseXbi, XbiInfo } from '@sie-js/fw';
import { sprintf } from 'sprintf-js';
import { FileIo, inspectFilesInArchive, inspectFilesInFS } from './inspector.js';

type ModelRoutingQuirks = {
	type: string;
	models: string[];
	target: string[];
	include?: (svn: number, fileName: string) => boolean;
	exclude?: (svn: number, fileName: string) => boolean;
};

// Files without fw version. Matched by known MD5/dates.
const NAMING_QUIRKS: Array<[RegExp, string]> = [
	[/^(FFSInit_CF62_[12]_)(.*?)\.exe$/i, "$1$2_21_0001.exe"],
	[/^(FFSInit_A55_[12]_)(.*?)\.exe$/i, "$1$2_09_0001.exe"],
	[/^(FFSInit_A60_[12]_)(.*?)\.exe$/i, "$1$2_27_0011.exe"],
	[/^(FFSInit_A65_[12]_)(.*?)\.exe$/i, "$1$2_10_0002.exe"],
	[/^(FFSInit_C60_[12]_)(.*?)\.exe$/i, "$1$2_25_0002.exe"],
	[/^(FFSInit_C55_[12]_)(.*?)\.exe$/i, "$1$2_24_0001.exe"],
	[/^(FFSInit_MC60_[12]_)(.*?)\.exe$/i, "$1$2_07_0001.exe"],
	[/^(FFSInit_A57_[12]_)(.*?)\.exe$/i, "$1$2_08_0001.exe"],
	[/^(FFSInit_M50_[12]_)(.*?)\.exe$/i, "$1$2_17_0001.exe"],
	[/^(FFSInit_M50I_[12]_)(.*?)\.exe$/i, "$1$2_81_0001.exe"],
];

const MAP_MODEL_QUIRKS: ModelRoutingQuirks[] = [
	// SL45, SL45i, SL42, SL42i, SL42 LaG
	{
		type: "map",
		models: ["U35", "U35K"],
		target: ["SLIN"],
		include: (svn) => svn >= 80
	}, {
		type: "map",
		models: ["U35", "U35K"],
		target: ["SLCK"],
		include: (svn, fileName) => [21, 49, 52, 54].includes(svn) && /1_Standard|6686/.test(fileName)
	}, {
		type: "map",
		models: ["U35", "U35K"],
		target: ["SLIK"],
		exclude: (svn, fileName) => svn >= 80 || /6686|SL42[^Ji]/.test(fileName)
	}, {
		type: "map",
		models: ["U35", "U35K"],
		target: ["SL45"],
		exclude: (svn, fileName) => svn >= 80 || /6686|SL42J|SL42i|Java/.test(fileName)
	},
	{
		type: "other",
		models: ["SLIN", "SLCK", "SLIK", "SL45"],
		target: ["SLIN", "SLCK", "SLIK", "SL45"]
	},
	// A3x
	{
		type: "map",
		models: ["A31", "A32", "A33", "A34", "A35", "A36", "A37", "A38", "A39", "A40", "B35N", "B35T"],
		target: ["A3x"]
	},
	// AC43
	{
		type: "map",
		models: ["AC43", "AC45"],
		target: ["AC43"]
	},
	// C25
	{
		type: "map",
		models: ["C25v4", "C25", "C28"],
		target: ["C25"]
	},
	// C3I
	{
		type: "map",
		models: ["C35", "M35", "M35i", "C35i", "C3588"],
		target: ["C3I"]
	},
	// S35
	{
		type: "map",
		models: ["S35", "S3588"],
		target: ["S35"]
	},
];

const KNOWN_SHIT_FILES = [
	/^(_\d+_)?NoDelta\.map$/i,
];

const FW_IN_DIR = "/home/azq2/Downloads/s";
const FW_OUT_DIR = `/media/azq2/backup/fw`;

const allFilesTree: string[] = [];
const savedFilesTree: Record<string, string> = {};
await inspectFilesInFS(FW_IN_DIR, onFwFound);
fs.writeFileSync("all_files.json", JSON.stringify(allFilesTree));
fs.writeFileSync("saved_files.json", JSON.stringify(savedFilesTree));

async function onFwFound(file: string, fileIo: FileIo, backtrace: string[], siblingFiles: string[]): Promise<void> {
	const id = [...backtrace, file].join('/');

	allFilesTree.push([...backtrace, file].join('/'));

	let parsedName = parseByName(file);
	if (!parsedName) {
		for (const [re, replace] of NAMING_QUIRKS) {
			if (re.test(path.basename(file))) {
				const newName = path.basename(file).replace(re, replace);
				parsedName = parseByName(path.dirname(file) + "/" + newName);
				if (parsedName)
					break;
			}
		}
	}

	if (parsedName) {
		if (parsedName.category == 'ffs' && file.match(/\.zip$/i)) {
			const [isFFS, shouldWarnIfNotFFS] = await isFFSArchive(await fileIo.getPath(file));
			if (!isFFS) {
				if (shouldWarnIfNotFFS && !isKnownShitFile(file))
					console.warn(`${id}: is not FFS!`);
				parsedName = undefined;
			}
		} else if (parsedName.category == 'map') {
			if (!['map', 'map.exe'].includes(detectContentType(await fileIo.getData(file)))) {
				if (!isKnownShitFile(file))
					console.warn(`${id}: is not MAP!`);
				parsedName = undefined;
			}
		}
	}

	if (parsedName) { // parsed by name
		if (parsedName.model == "SX1")
			return;

		const modelsToSave = applyModelRoutingQuirks(parsedName.category, parsedName.model, parsedName.svn!, parsedName.toString());
		for (const modelName of modelsToSave) {
			const newFileName = parsedName.svn != null ?
				`${normalizeModel(modelName)}/${parsedName.svn}/${parsedName.category}/${parsedName.toString()}` :
				`${normalizeModel(modelName)}/${parsedName.category}/${parsedName.toString()}`;
			saveFwFile(newFileName, await fileIo.getData(file), [...backtrace, file]);
		}
	} else if (file.match(/\.(rar|zip|7z)$/i)) {
		await inspectFilesInArchive(file, await fileIo.getPath(file), onFwFound, [...backtrace]);
	} else if (file.match(/\.exe$/i) && isSEA(await fileIo.getPath(file))) {
		await inspectFilesInArchive(file, await fileIo.getPath(file), onFwFound, [...backtrace]);
	} else if (file.match(/\.exe$/i)) {
		const blob = await fileIo.getData(file);

		const exeType = detectExeType(blob);
		if (!exeType)
			return;

		const extractedFiles = extractFromExe(blob);
		if (!extractedFiles) {
			console.error(`${id}: Broken EXE!`);
			return;
		}

		let partContentType: string | undefined;
		try {
			partContentType = detectContentType(extractedFiles[0]);
		} catch (e) {
			console.error(`${id}: broken XBI - ${e}`);
			return;
		}

		if (extractedFiles.length > 1) {
			const xbi = parseXbi(extractedFiles[0], true);
			if (!xbi)
				throw new Error(`Can't parse XBI!`);

			if (xbi.model == null) {
				console.error(`${id}: no model in XBI!`);
				return;
			}

			if (extractedFiles.length != 4)
				throw new Error(`Invalid SCOUT!`);

			const newExeName = getNameFromXBI(xbi, "scout") + "_SCOUT_" + getXbiExtension(xbi).toLocaleUpperCase() + ".exe";
			saveFwFile(newExeName, blob, [...backtrace, file]);
		} else if (partContentType == 'xbi' || partContentType == 'xbz') {
			const xbi = parseXbi(extractedFiles[0], true);
			if (!xbi)
				throw new Error(`Can't parse XBI!`);

			if (xbi.model == null) {
				console.error(`${id}: no model in XBI!`);
				return;
			}

			if (xbi.model == "SX1")
				return;

			if (isUserSwup(xbi)) {
				const newExeName = `${normalizeModel(xbi.model!)}/userswup/${path.basename(file)}`;
				saveFwFile(newExeName, blob, [...backtrace, file]);
			} else {
				let postfix = "";
				if (file.match(/[0-9][0-9][0-9]wbsl[^a-z]/i)) {
					postfix = "wbsl";
				} else if (file.match(/[0-9][0-9][0-9]w[^a-z]/i)) {
					postfix = "w";
				}

				let exeTypePostfix = exeType;
				if (exeType == 'service') {
					const serviceExeFormatVersion = detectServiceExeFormatVersion(blob);
					if (serviceExeFormatVersion == 0)
						exeTypePostfix = "service_DOS";
				}

				const newExeName = getNameFromXBI(xbi, "fw") + `${postfix}.${getXbiExtension(xbi)}_${exeTypePostfix}.exe`;
				if (blob.indexOf(Buffer.from("BFB95EG")) >= 0 || isMSDOS(await fileIo.getPath(file))) {
					const siglingFiles = findSiblingDLL(file, siblingFiles);
					if (siglingFiles.length) {
						for (const siglingFile of siglingFiles) {
							const siblingFileName = path.basename(siglingFile).toLowerCase();
							const siblingFilePath = `${newExeName}.d/${siblingFileName}`;
							const siblingFileData = await fileIo.getData(siglingFile);
							if (siblingFileName == "bfb95eg.dll" && !isBFB95EGValid(siblingFileData)) {
								console.error(`${[...backtrace, siglingFile].join("/")}: broken DLL`);
								continue;
							}
							saveFwFile(siblingFilePath, siblingFileData, [...backtrace, siglingFile]);
						}
					} else {
						// console.warn(`${id}: BFB95EG not found!`);
					}
				}

				saveFwFile(newExeName, blob, [...backtrace, file]);
			}
		} else if (partContentType == 'xfs') {
			const xbi = parseXbi(extractedFiles[0], true);
			if (!xbi)
				throw new Error(`Can't parse XBI!`);

			if (xbi.model == null) {
				console.error(`${id}: no model in XBI!`);
				return;
			}

			if (xbi.model == "SX1")
				return;

			if (isUserSwup(xbi)) {
				const newExeName = `${normalizeModel(xbi.model!)}/userswup/${path.basename(file)}`;
				saveFwFile(newExeName, blob, [...backtrace, file]);
			} else {
				const xfsName = getVersionFromFFS(convertXbiToFlash(extractedFiles[0]));
				if (xfsName) {
					const newExeName = `${normalizeModel(xbi.model!)}/${xbi.svn}/ffs/${xfsName}.xfs_service.exe`;
					saveFwFile(newExeName, blob, [...backtrace, file]);
				} else {
					console.error(`${id}: unknown XFS!`);
				}
			}
		} else if (partContentType == 'zip') {
			const tmpFile = `/tmp/sie-fw-finder-${Date.now()}-${calcMD5(Buffer.from(id))}.zip`;
			try {
				fs.writeFileSync(tmpFile, extractedFiles[0]);

				const ffsName = await getVersionFromZIP(tmpFile);
				if (ffsName) {
					const newName = `FFSInit_${ffsName}.exe`;
					const parsedNewName = parseByName(newName);

					if (parsedNewName) {
						const newExeName = `${normalizeModel(parsedNewName.model)}/${parsedNewName.svn}/ffs/${newName}`;
						saveFwFile(newExeName, blob, [...backtrace, file]);
					} else {
						console.error(`${id}: BAD FFS NAME: ${newName}`);
					}
				} else {
					console.error(`${id}: unknown FFS!`);
				}
			} finally {
				if (fs.existsSync(tmpFile))
					fs.unlinkSync(tmpFile);
			}
		} else {
			const isKnownUnusefulFile = (
				// SX1
				extractedFiles[0].indexOf(Buffer.from("EPOCARM\x20ROM\x20\x20\x20\x20\x20\x20")) >= 0
			);
			if (!isKnownUnusefulFile)
				console.error(`${id}: unknown exe part ${partContentType}`);
		}
	} else if (isXbiFileName(file)) {
		const blob = await fileIo.getData(file);
		if (!isXbi(blob))
			throw new RecoverableError(`Is not XBI!`);

		const xbi = parseXbi(blob, true);
		if (!xbi)
			throw new Error(`Can't parse XBI!`);

		if (xbi.model == null) {
			console.error(`${id}: no model in XBI!`);
			return;
		}

		if (xbi.model == "SX1")
			return;

		if (isUserSwup(xbi)) {
			const newExeName = `${normalizeModel(xbi.model)}/userswup/${path.basename(file)}`;
			saveFwFile(newExeName, blob, [...backtrace, file]);
			return;
		}

		let fileExt = file.match(/\.([^.]+)$/i)?.[1].toLowerCase()!;
		if (fileExt == 'xbi' || fileExt == 'xbz' || fileExt == 'xfs')
			fileExt = getXbiExtension(xbi);

		let targetDir = "fw";
		if (fileExt == "exci" || fileExt == "exbi") {
			targetDir = "factory";
		} else if (["xci", "xl", "xlm", "xt", "xtm"].includes(fileExt)) {
			targetDir = "split";
		} else if (fileExt == "xfs") {
			targetDir = "ffs";
		}

		const newXbiName = getNameFromXBI(xbi, targetDir) + "." + fileExt;
		saveFwFile(newXbiName, blob, [...backtrace, file]);
	} else if (file.match(/\.(map)$/i) && detectContentType(await fileIo.getData(file)) == 'map') {
		if (!isKnownShitFile(file))
			console.error(`${id}: unknown map name!`);
	} else {
		// console.log(file);
	}
}

function findSiblingDLL(file: string, siblingFiles: string[]): string[] {
	const files: string[] = [];
	for (const siblingFile of siblingFiles) {
		if (path.dirname(file) != path.dirname(siblingFile))
			continue;
		const lcName = path.basename(siblingFile).toLowerCase();
		if (["bfb95eg.dll", "swup.ini", "swupinst.exe", "readme.txt", "liesmich.txt"].includes(lcName))
			files.push(siblingFile);
	}
	return files;
}

function getNameFromXBI(xbi: XbiInfo, dir: string): string {
	const model = normalizeModel(xbi.model!);
	if (xbi.langpack != null && xbi.t9 != null) {
		const lgpId = +xbi.langpack.replace(/^[a-z_-]+/i, '');
		return `${model}/${xbi.svn}/${dir}/${model}_${sprintf("%02d%02d%02d", xbi.svn, lgpId, xbi.t9)}`;
	} else if (xbi.langpack != null) {
		const lgpId = +xbi.langpack.replace(/^[a-z_-]+/i, '');
		return `${model}/${xbi.svn}/${dir}/${model}_${sprintf("%02d%02d", xbi.svn, lgpId)}`;
	} else {
		return `${model}/${xbi.svn}/${dir}/${model}_${sprintf("%02d", xbi.svn)}`;
	}
}

function saveFwFile(fileName: string, buffer: Buffer, originalFile: string[]): void {
	// console.info(`${originalFile.join('/')} => ${fileName}`);

	savedFilesTree[originalFile.join('/')] = fileName;

	const fullPath = `${FW_OUT_DIR}/${fileName}`;
	if (!fs.existsSync(path.dirname(fullPath)))
		fs.mkdirSync(path.dirname(fullPath), { recursive: true });

	const oldFilePath = isFileExists(fullPath);
	if (oldFilePath) {
		const oldBuffer = fs.readFileSync(oldFilePath);
		const newMD5 = calcMD5(buffer);
		const oldMD5 = calcMD5(oldBuffer);
		if (newMD5 === oldMD5)
			return;

		if (path.basename(fileName).toLowerCase() == "bfb95eg.dll") {
			const newBuffer = compareBFB95EG(oldBuffer, buffer);
			if (newBuffer != null) {
				fs.writeFileSync(fullPath, newBuffer);
				return;
			}
		}

		if (fileName.match(/\.exe$/i)) {
			const newBuffer = compareUpdaters(oldBuffer, buffer);
			if (newBuffer != null) {
				fs.writeFileSync(fullPath, newBuffer);
				return;
			}
		} else if (fileName.match(/\.map$/i)) {
			const newBuffer = compareMaps(oldBuffer, buffer);
			if (newBuffer != null) {
				fs.writeFileSync(fullPath, newBuffer);
				return;
			}
		} else if (isXbi(buffer)) {
			const newBuffer = compareXbis(oldBuffer, buffer);
			if (newBuffer != null) {
				fs.writeFileSync(fullPath, newBuffer);
				return;
			}
		}

		fs.writeFileSync("/tmp/duplicate.bin", buffer); // FIXME: remove
		throw new RecoverableError(`File already exists: ${oldFilePath}`);
	} else {
		fs.writeFileSync(fullPath, buffer);
	}
}

function isFileExists(filePath: string): string | undefined {
	if (fs.existsSync(filePath))
		return filePath;
	const targetFileName = path.basename(filePath).toLowerCase();
	const filenames = fs.readdirSync(path.dirname(filePath));
	for (const file of filenames) {
		if (file.toLowerCase() === targetFileName)
			return path.dirname(filePath) + "/" + file;
	}
	return undefined;
}

function isXbiFileName(file: string): boolean {
	return /\.(xbi|xbz|xbn|xfs|exci|exbi|xt|xtm|xl|xlm|xci)$/i.test(file);
}

function isKnownShitFile(file: string) {
	for (const re of KNOWN_SHIT_FILES) {
		if (re.test(path.basename(file)))
			return true;
	}
	return false;
}

function applyModelRoutingQuirks(type: string, model: string, svn: number, fileName: string): string[] {
	const modelsToSave = [];
	let hasQuirks = 0;
	for (const quirk of MAP_MODEL_QUIRKS) {
		if (quirk.type != type)
			continue;
		if (!quirk.models.includes(model))
			continue;
		hasQuirks++;
		if (quirk.exclude && quirk.exclude(svn, fileName))
			continue;
		if (!quirk.include || quirk.include(svn, fileName))
			modelsToSave.push(...quirk.target);
	}
	if (hasQuirks > 0 && !modelsToSave.length)
		throw new RecoverableError(`Can't choose output directory for ${fileName}.`);
	return modelsToSave.length > 0 ? modelsToSave : [model];
}
