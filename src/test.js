import fs from 'node:fs';
import { compareUpdaters } from './utils.js';

console.log(compareUpdaters(
	fs.readFileSync("/tmp/duplicate.bin"),
	fs.readFileSync("/media/azq2/backup/fw//S75/24/fw/S75_240300.xbz_update.exe"),
));
