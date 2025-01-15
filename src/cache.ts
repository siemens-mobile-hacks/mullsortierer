import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { calcMD5 } from './utils.js';
import path from 'node:path';

let globalCacheDir: string | undefined;

export function cacheInit(cacheDir: string) {
	globalCacheDir = cacheDir;
}

export async function cacheGet<T>(key: string, gen: () => T | Promise<T>): Promise<T> {
	const cacheFile = cacheGetFile(key);
	if (fs.existsSync(cacheFile)) {
		if (key.endsWith(".json")) {
			return (await fsPromises.readFile(cacheFile)).toJSON() as T;
		} else {
			return await fsPromises.readFile(cacheFile) as T;
		}
	} else {
		const value = await gen();
		cacheSet(key, value);
		return value;
	}
}

export function cacheGetFile(key: string): string {
	const md5 = calcMD5(key);
	const p1 = md5.substring(0, 2);
	const p2 = md5.substring(2, 4);
	const p3 = md5.substring(4, 6);
	return `${globalCacheDir}/${p1}/${p2}/${p3}/${key}`;
}

export async function cacheSet<T>(key: string, data: T): Promise<void> {
	const cacheFile = cacheGetFile(key);
	if (!fs.existsSync(cacheFile)) {
		if (!fs.existsSync(path.dirname(cacheFile)))
			fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
		if (key.endsWith(".json")) {
			await fsPromises.writeFile(cacheFile, JSON.stringify(data));
		} else {
			await fsPromises.writeFile(cacheFile, data as Buffer);
		}
	}

	return undefined;
}
