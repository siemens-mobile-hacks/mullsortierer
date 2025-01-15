import fs from 'node:fs';
import { compareUpdaters, compareBFB95EG, isFFSArchive } from './utils.js';

/*
console.log(compareUpdaters(
	fs.readFileSync("/tmp/duplicate.bin"),
	fs.readFileSync("/media/azq2/backup/fw//S75/24/fw/S75_240300.xbz_update.exe"),
));
*/

console.log(await isFFSArchive("/media/azq2/backup/fw/A31/7/ffs/A31_2_ru-RussianRetail_07_0001.zip"));

console.log(compareBFB95EG(
	fs.readFileSync("/tmp/duplicate.bin"),
	fs.readFileSync("/media/azq2/backup/fw/C3i/18/fw/C3i_1801w.xbi_service.exe.d/bfb95eg.dll"),
));
