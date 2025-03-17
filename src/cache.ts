import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { calcMD5 } from './utils.js';
import path from 'node:path';

let globalCacheDir: string | undefined;

export function cacheIsEnabled() {
	return globalCacheDir != null;
}

export function cacheInit(cacheDir: string) {
	globalCacheDir = cacheDir;
}

export async function cacheGetBuffer(key: string, gen: () => Buffer | Promise<Buffer>): Promise<Buffer> {
	if (globalCacheDir == null)
		return gen();
	const cacheFile = cacheKeyToFile(key);
	if (fs.existsSync(cacheFile)) {
		return await fsPromises.readFile(cacheFile);
	} else {
		const value = await gen();
		await cacheSetBuffer(key, value);
		return value;
	}
}

export async function cacheGetJson<T>(key: string, gen: () => T | Promise<T>): Promise<T> {
	if (globalCacheDir == null)
		return gen();
	const json = await cacheGetBuffer(`JSON:${key}`, async () => {
		return Buffer.from(JSON.stringify(await gen()));
	});
	return JSON.parse(json.toString()) as T;
}

export async function cacheGetFile(key: string, gen: () => Buffer | Promise<Buffer>): Promise<string> {
	if (globalCacheDir == null)
		throw new Error("Cache is not enabled!");
	const cacheFile = cacheKeyToFile(key);
	if (!fs.existsSync(cacheFile)) {
		const value = await gen();
		await cacheSetBuffer(key, value);
	}
	return cacheFile;
}

export async function cacheSetBuffer(key: string, data: Buffer): Promise<void> {
	if (globalCacheDir == null)
		throw new Error("Cache is not enabled!");
	const cacheFile = cacheKeyToFile(key);
	if (!fs.existsSync(cacheFile)) {
		if (!fs.existsSync(path.dirname(cacheFile)))
			fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
		console.warn("NEW CACHE:", cacheFile);
		await fsPromises.writeFile(cacheFile, data);
	}
	return undefined;
}

function cacheKeyToFile(key: string): string {
	const md5 = calcMD5(key);
	const p1 = md5.substring(0, 2);
	const p2 = md5.substring(2, 4);
	const p3 = md5.substring(4, 6);
	return `${globalCacheDir}/${p1}/${p2}/${p3}/${md5}`;
}
