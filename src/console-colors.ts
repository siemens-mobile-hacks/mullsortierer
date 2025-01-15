import styles from 'ansi-styles';

const prevConsoleError = console.error;
const prevConsoleWarn = console.warn;

console.error = (...data: any[]) => {
	process.stderr.write(styles.red.open);
	prevConsoleError.apply(console, data);
	process.stderr.write(styles.red.close);
};
console.warn = (...data: any[]) => {
	process.stderr.write(styles.yellow.open);
	prevConsoleWarn.apply(console, data);
	process.stderr.write(styles.yellow.close);
};

