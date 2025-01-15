import fs from 'node:fs';
import { calcMD5, extractFileFromArchive, getFilesFromArchive, RecoverableError, readFiles, XADEntry } from './utils.js';

// Archive passwords:
// "handy-faq.de"
// "faq4mobiles.de"

export interface FileIo {
	getData(file: string): Promise<Buffer>;
	getPath(file: string): Promise<string>;
	release(file: string): Promise<void>;
};

export type OnFwFoundCallback = (file: string, fileIo: FileIo, backtrace: string[], siblingFiles: string[]) => Promise<void>;

export async function inspectFiles(files: string[], fileIo: FileIo, onFwFound: OnFwFoundCallback, backtrace: string[]) {
	let promises: Promise<void>[] = [];
	for (const file of files) {
		const worker = async () => {
			try {
				await onFwFound(file, fileIo, [...backtrace], files);
			} catch (e) {
				const id = [...backtrace, file].join('/');
				if (e instanceof RecoverableError) {
					console.error(`${id}: ${e.message}`);
				} else if (e instanceof Error) {
					console.error(`${id}: ${e.message}`);
					throw e;
				} else {
					throw e;
				}
			}
			await fileIo.release(file);
		};
		promises.push(worker());

		if (promises.length >= 48) {
			await Promise.all(promises);
			promises = [];
		}
	}

	if (promises.length > 0)
		await Promise.all(promises);
}

export async function inspectFilesInFS(dir: string, onFwFound: OnFwFoundCallback, backtrace: string[] = []) {
	backtrace.push(dir);

	const fileIo: FileIo = {
		async getData(file) {
			return fs.readFileSync(`${dir}/${file}`);
		},
		async getPath(file) {
			return `${dir}/${file}`;
		},
		async release(_) {
			// Nothing
		}
	};
	await inspectFiles(readFiles(dir), fileIo, onFwFound, [...backtrace]);

	backtrace.pop();
}

export async function inspectFilesInArchive(archiveName: string, archiveFile: string, onFwFound: OnFwFoundCallback, backtrace: string[] = []) {
	const id = [...backtrace, archiveName].join('/');
	const archive = await getFilesFromArchive(archiveFile);

	if (archive.lsarProperties.XADIsEncrypted) {
		console.error(`${id}: Password protected archive!`);
		return;
	}

	backtrace.push(archiveName);

	const fileToBuffer: Record<string, Buffer> = {};
	const fileToTempPath: Record<string, string> = {};
	const fileToEntry: Record<string, XADEntry> = {};
	const files: string[] = [];
	for (const entry of archive.lsarContents) {
		if (entry.XADIsDirectory)
			continue;
		fileToEntry[entry.XADFileName] = entry;
		files.push(entry.XADFileName);
	}

	const fileIo: FileIo = {
		async getData(file) {
			if (!(file in fileToBuffer)) {
				fileToBuffer[file] = await extractFileFromArchive(archiveFile, fileToEntry[file].XADIndex);
				if (fileToEntry[file].XADFileSize != fileToBuffer[file].length)
					throw new RecoverableError(`File corrupted after extraction from archive.`);
			}
			return fileToBuffer[file];
		},
		async getPath(file) {
			if (!fileToTempPath[file]) {
				const blob = await fileIo.getData(file);
				fileToTempPath[file] = `/tmp/sie-fw-finder-${Date.now()}-${calcMD5([archiveFile, file].join(':'))}.temp`;
				fs.writeFileSync(fileToTempPath[file], blob);
			}
			return fileToTempPath[file];
		},
		async release(file) {
			if (fileToTempPath[file])
				fs.unlinkSync(fileToTempPath[file]);
			delete fileToBuffer[file];
			delete fileToTempPath[file];
		}
	};
	await inspectFiles(files, fileIo, onFwFound, [...backtrace]);

	backtrace.pop();
}
