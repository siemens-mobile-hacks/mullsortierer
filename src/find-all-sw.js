import fs from 'node:fs';
import path from 'node:path';
import {
	readFiles, getFilesFromArchive, extractFileFromArchive, calcMD5,
	parseByName, detectContentType,
    normalizeModel,
    isSEA,
    compareUpdaters,
    compareMaps,
    compareXbis
} from './utils.js';
import { convertXbiToFlash, detectExeType, extractFromExe, getVersionFromFFS, getXbiExtension, isXbi, parseXbi } from '@sie-js/fw';
import { sprintf } from 'sprintf-js';

// const FW_IN_DIR = "/home/azq2/Downloads/s/";
// const FW_OUT_DIR = `/media/azq2/backup/fw/`;

const FW_IN_DIR = "/home/azq2/SIE/";
const FW_OUT_DIR = `/home/azq2/SIE_BIG_FW/`;

let allFilesTree = [];
let savedFilesTree = {};
await inspectFilesInFS(FW_IN_DIR, onFwFound);
fs.writeFileSync("all_files.json", JSON.stringify(allFilesTree));
fs.writeFileSync("saved_files.json", JSON.stringify(savedFilesTree));

async function onFwFound(file, fileIo, backtrace) {
	allFilesTree.push([...backtrace, file].join(' -> '));

	let parsedName = parseByName(file);

	if (parsedName) {
		if (parsedName.file == 'ffs' && file.match(/\.zip$/i)) {
			let archive;
			try {
				let blobPath = await fileIo.getPath(file);
				if (blobPath == null) {
					console.error(`${[...backtrace, file].join(' -> ')}: Invalid archive!`);
				} else {
					archive = await getFilesFromArchive(blobPath);
				}
			} catch (e) {
				console.error(`${[...backtrace, file].join(' -> ')}: Invalid archive!`);
			}

			if (archive) {
				if (!isFFSArchive(archive.lsarContents)) {
					console.log(`${[...backtrace, file].join(' -> ')} is not FFS!`);
					parsedName = null;
				}
			}
		} else if (parsedName.file == 'map') {
			let blob = await fileIo.getData(file);
			if (blob == null) {
				console.error(`${[...backtrace, file].join(' -> ')}: Invalid archive!`);
				return;
			}

			if (detectContentType(blob) != 'map') {
				console.log(`${[...backtrace, file].join(' -> ')} is not MAP!`);
				parsedName = null;
			}
		}
	}

	if (parsedName) { // parsed by name
		let newFileName = parsedName.svn != null ?
			`${normalizeModel(parsedName.model)}/${parsedName.svn}/${parsedName.file}/${parsedName.toString()}` :
			`${normalizeModel(parsedName.model)}/${parsedName.file}/${parsedName.toString()}`;
		console.log(`${[...backtrace, file].join(' -> ')}`);

		let blob = await fileIo.getData(file);
		if (blob == null) {
			console.error(`${[...backtrace, file].join(' -> ')}: Invalid archive!`);
			return;
		}

		saveFwFile(newFileName, blob, [...backtrace, file]);
	} else if (file.match(/\.(rar|zip|7z)$/i)) {
		let blobPath = await fileIo.getPath(file);
		if (blobPath == null) {
			console.error(`${[...backtrace, file].join(' -> ')}: Invalid archive!`);
			return;
		}
		await inspectFilesInArchive(file, blobPath, onFwFound, [...backtrace]);
	} else if (file.match(/\.exe$/i) && isSEA(await fileIo.getPath(file))) {
		await inspectFilesInArchive(file, await fileIo.getPath(file), onFwFound, [...backtrace]);
	} else if (file.match(/\.exe$/i)) {
		let blob = await fileIo.getData(file);
		if (blob == null) {
			console.error(`${[...backtrace, file].join(' -> ')}: Invalid archive!`);
			return;
		}

		// Check if this update/winswup .exe
		let exeType = detectExeType(blob);
		if (!exeType)
			return;

		let extractedFiles = extractFromExe(blob);
		if (!extractedFiles) {
			console.error(`${[...backtrace, file].join(' -> ')}: Broken EXE!`);
			return;
		}

		let partContentType;
		try {
			partContentType = detectContentType(extractedFiles[0]);
		} catch (e) {
			console.error(`${[...backtrace, file].join(' -> ')}: broken XBI - ${e.message}`);
			return;
		}

		if (partContentType == 'xbi' || partContentType == 'xbz') {
			let xbi = parseXbi(extractedFiles[0], true);

			let isUserSwup = false;
			if (xbi.databaseName == 'projects' || xbi.baseline == 'PV_bin2swp_V0.0' || xbi.baselineRelease == 'PapuaSoft_and_PapuaHard')
				isUserSwup = true;
			if (xbi.flashSize >= 2 * 1024 * 1024 && extractedFiles[0].length < 1024 * 1024)
				isUserSwup = true;

			if (xbi.releaseType != 'OFFICIAL') {
				let postfix = `${xbi.releaseType}_${xbi.reconfigureTime}`.replace(/[:]/g, '-').replace(/[\s]/g, '_');
				let newExeName = getNameFromXBI(xbi) + `${postfix}.${getXbiExtension(xbi)}_${exeType}.exe`;
				console.log(`${[...backtrace, file].join(' -> ')}`);
				saveFwFile(newExeName, blob, [...backtrace, file]);
			} else if (isUserSwup) {
				let newExeName = `${normalizeModel(xbi.model)}/userswup/${path.basename(file)}`;
				console.log(`${[...backtrace, file].join(' -> ')}`);
				saveFwFile(newExeName, blob, [...backtrace, file]);
			} else {
				let postfix = "";
				if (file.match(/[0-9][0-9][0-9]wbsl[^a-z]/i)) {
					postfix = "wbsl";
				} else if (file.match(/[0-9][0-9][0-9]w[^a-z]/i)) {
					postfix = "w";
				}
				let allsiemens = false;//blob.indexOf('allsiemens.com') >= 0;
				let newExeName = getNameFromXBI(xbi) + `${postfix}.${getXbiExtension(xbi)}_${exeType}${allsiemens ? '_(allsiemens.com)' : ""}.exe`;
				console.log(`${[...backtrace, file].join(' -> ')}`);
				saveFwFile(newExeName, blob, [...backtrace, file]);
			}
		} else if (partContentType == 'xfs') {
			let xbi = parseXbi(extractedFiles[0], true);
			if (xbi.databaseName == 'projects' || xbi.baseline == 'PV_bin2swp_V0.0' || xbi.baselineRelease == 'PapuaSoft_and_PapuaHard') {
				let newExeName = `${normalizeModel(xbi.model)}/userswup/${path.basename(file)}`;
				console.log(`${[...backtrace, file].join(' -> ')}`);
				saveFwFile(newExeName, blob, [...backtrace, file]);
			} else {
				let xfsName = getVersionFromFFS(convertXbiToFlash(extractedFiles[0]));
				if (xfsName) {
					let allsiemens = false;//blob.indexOf('allsiemens.com') >= 0;
					let newExeName = `${normalizeModel(xbi.model)}/${xbi.svn}/ffs/${xfsName}.xfs_service.exe`;
					console.log(`${[...backtrace, file].join(' -> ')}`);
					saveFwFile(newExeName, blob, [...backtrace, file]);
				} else {
					console.error(`${[...backtrace, file].join(' -> ')}: unknown exe part ${partContentType}`);
				}
			}
		} else {
			console.error(`${[...backtrace, file].join(' -> ')}: unknown exe part ${partContentType}`);
		}
	} else if (isXbiFileName(file)) {
		let blob = await fileIo.getData(file);
		if (blob == null) {
			console.error(`${[...backtrace, file].join(' -> ')}: Invalid archive!`);
			return;
		}

		let xbi;
		try {
			xbi = parseXbi(blob, true);
			if (xbi.model == null)
				throw new Error(`No model in XBI!!!`);
		} catch (e) {
			console.error(`${[...backtrace, file].join(' -> ')}: broken XBI - ${e.message}`);
			return;
		}

		let isUserSwup = false;
		if (xbi.databaseName == 'projects' || xbi.baseline == 'PV_bin2swp_V0.0' || xbi.baselineRelease == 'PapuaSoft_and_PapuaHard')
			isUserSwup = true;
		if (xbi.flashSize >= 2 * 1024 * 1024 && blob.length < 1024 * 1024)
			isUserSwup = true;

		if (isUserSwup) {
			let newExeName = `${normalizeModel(xbi.model)}/userswup/${path.basename(file)}`;
			console.log(`${[...backtrace, file].join(' -> ')}`);
			saveFwFile(newExeName, blob, [...backtrace, file]);
			return;
		}

		let fileExt = file.match(/\.([^.]+)$/i)[1].toLowerCase();

		if (fileExt == 'xbi' || fileExt == 'xbz' || fileExt == 'xfs')
			fileExt = getXbiExtension(xbi);

		let newXbiName = getNameFromXBI(xbi) + "." + fileExt;
		console.log(`${[...backtrace, file].join(' -> ')}`);
		saveFwFile(newXbiName, blob, [...backtrace, file]);
	} else if (file.match(/\.(map)$/i)) {
		console.error(`${[...backtrace, file].join(' -> ')}: unknown map!`);
	} else {
		// console.log(file);
	}
}

function getNameFromXBI(xbi) {
	let model = normalizeModel(xbi.model);
	if (xbi.langpack != null && xbi.t9 != null) {
		let lgpId = +xbi.langpack.replace(/lg/, '');

		if (xbi.releaseType != 'OFFICIAL') {
			let postfix = `${xbi.releaseType}_${xbi.reconfigureTime}`.replace(/[:]/g, '-').replace(/[\s]/g, '_');
			return `${model}/proto/${xbi.svn}/fw/${model}_${sprintf("%02d%02d%02d_%s", xbi.svn, lgpId, xbi.t9, postfix)}`;
		} else {
			return `${model}/${xbi.svn}/fw/${model}_${sprintf("%02d%02d%02d", xbi.svn, lgpId, xbi.t9)}`;
		}
	} else if (xbi.langpack != null) {
		let lgpId = +xbi.langpack.replace(/lg/, '');
		if (xbi.releaseType != 'OFFICIAL') {
			let postfix = `${xbi.releaseType}_${xbi.reconfigureTime}`.replace(/[:]/g, '-').replace(/[\s]/g, '_');
			return `${model}/proto/${xbi.svn}/fw/${model}_${sprintf("%02d%02d_%s", xbi.svn, lgpId, postfix)}`;
		} else {
			return `${model}/${xbi.svn}/fw/${model}_${sprintf("%02d%02d", xbi.svn, lgpId)}`;
		}
	} else {
		if (xbi.releaseType != 'OFFICIAL') {
			let postfix = `${xbi.releaseType}_${xbi.reconfigureTime}`.replace(/[:]/g, '-').replace(/[\s]/g, '_');
			return `${model}/${xbi.svn}/fw/${model}_${sprintf("%02d_%s", xbi.svn, postfix)}`;
		} else {
			return `${model}/${xbi.svn}/fw/${model}_${sprintf("%02d", xbi.svn)}`;
		}
	}
}

function saveFwFile(fileName, buffer, originalFile) {
	console.info(`  save: ${fileName}`);

	savedFilesTree[originalFile.join(' -> ')] = fileName;

	let fullPath = `${FW_OUT_DIR}/${fileName}`;
	if (!fs.existsSync(path.dirname(fullPath)))
		fs.mkdirSync(path.dirname(fullPath), { recursive: true });

	let oldFilePath = isFileExists(fullPath);
	if (oldFilePath) {
		let oldBuffer = fs.readFileSync(oldFilePath);
		let newMD5 = calcMD5(buffer);
		let oldMD5 = calcMD5(oldBuffer);
		if (newMD5 === oldMD5)
			return;

		if (fileName.match(/\.exe$/i)) {
			let newBuffer = compareUpdaters(oldBuffer, buffer);
			if (newBuffer != null) {
				fs.writeFileSync(fullPath, newBuffer);
				return;
			}
		} else if (fileName.match(/\.map$/i)) {
			let newBuffer = compareMaps(oldBuffer, buffer);
			if (newBuffer != null) {
				fs.writeFileSync(fullPath, newBuffer);
				return;
			}
		} else if (isXbi(buffer)) {
			let newBuffer = compareXbis(oldBuffer, buffer);
			if (newBuffer != null) {
				fs.writeFileSync(fullPath, newBuffer);
				return;
			}
		}

		fs.writeFileSync("/tmp/duplicate.bin", buffer); // FIXME: remove
		throw new Error(`File already exists: ${oldFilePath}`);
	} else {
		fs.writeFileSync(fullPath, buffer);
	}
}

function isFileExists(filePath) {
	if (fs.existsSync(filePath))
		return filePath;
	let targetFileName = path.basename(filePath).toLowerCase();
	let filenames = fs.readdirSync(path.dirname(filePath));
	for (let file of filenames) {
		if (file.toLowerCase() === targetFileName)
			return path.dirname(filePath) + "/" + file;
	}
	return null;
}

async function inspectFiles(files, fileIo, onFwFound, backtrace) {
	let promises = [];
	for (let file of files) {
		let worker = async () => {
			await onFwFound(file, fileIo, [...backtrace]);
			await fileIo.release(file);
		};
		promises.push(worker());

		if (promises.length >= 16) {
			await Promise.all(promises);
			promises = [];
		}
	}

	if (promises.length > 0)
		await Promise.all(promises);
}

function isFFSArchive(files) {
	for (let file of files) {
		if (file.XADFileName.match(/\/(ccq_vinfo\.txt|ccq_chk\.log|graphcach|_cleargc|profile\.pd)$/i))
			return true;
	}
	return false;
}

function isXbiFileName(file) {
	return file.match(/\.(xbi|xbz|xfs)$/i);
}

async function inspectFilesInFS(dir, onFwFound, backtrace = []) {
	backtrace.push(dir);

	let fileIo = {
		getData(file) {
			return fs.readFileSync(`${dir}/${file}`);
		},
		getPath(file) {
			return `${dir}/${file}`;
		},
		release(file) {
			// Nothing
		}
	};
	await inspectFiles(readFiles(dir), fileIo, onFwFound, [...backtrace]);

	backtrace.pop();
}

async function inspectFilesInArchive(archiveName, archiveFile, onFwFound, backtrace = []) {
	let archive;
	try {
		archive = await getFilesFromArchive(archiveFile);
	} catch (e) {
		console.error(`${[...backtrace, archiveName].join(' -> ')}: Invalid archive!`);
		return;
	}

	backtrace.push(archiveName);

	let fileToBuffer = {};
	let fileToTempPath = {};
	let fileToIndex = {};
	let files = [];
	for (let entry of archive.lsarContents) {
		if (entry.XADIsDirectory)
			continue;
		fileToIndex[entry.XADFileName] = entry.XADIndex;
		files.push(entry.XADFileName);
	}

	let fileIo = {
		async getData(file) {
			if (!fileToBuffer[file]) {
				try {
					fileToBuffer[file] = await extractFileFromArchive(archiveFile, fileToIndex[file]);
				} catch (e) {
					return null;
				}
			}
			return fileToBuffer[file];
		},
		async getPath(file) {
			if (!fileToTempPath[file]) {
				fileToTempPath[file] = `/tmp/sie-fw-finder-${Date.now()}-${calcMD5([archiveFile, file].join(':'))}.temp`;
				let blob = await fileIo.getData(file);
				if (blob == null) {
					delete fileToTempPath[file];
					return null;
				}
				fs.writeFileSync(fileToTempPath[file], blob);
			}
			return fileToTempPath[file];
		},
		release(file) {
			if (fileToTempPath[file])
				fs.unlinkSync(fileToTempPath[file]);
			delete fileToBuffer[file];
			delete fileToTempPath[file];
		}
	};
	await inspectFiles(files, fileIo, onFwFound, [...backtrace]);

	backtrace.pop();
}
