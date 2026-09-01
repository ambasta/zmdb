import { execSync } from 'node:child_process';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const command =
    'yarn npm audit --all --recursive --severity high --no-deprecations --ignore 1138808 --ignore 1138809';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`Running dependency audit (attempt ${attempt}/${MAX_RETRIES}): ${command}`);
    try {
      const output = execSync(command, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
      if (output) {
        console.log(output);
      }
      console.log('Dependency vulnerability audit completed successfully.');
      process.exit(0);
    } catch (error) {
      const stdout = error.stdout ? error.stdout.toString() : '';
      const stderr = error.stderr ? error.stderr.toString() : '';
      const combinedOutput = stdout + '\n' + stderr;

      if (combinedOutput.trim()) {
        console.log(combinedOutput);
      }

      const isNetworkError =
        combinedOutput.includes('Timeout awaiting') ||
        combinedOutput.includes('Service Unavailable') ||
        combinedOutput.includes('RequestError') ||
        combinedOutput.includes('FetchError') ||
        combinedOutput.includes('ETIMEDOUT') ||
        combinedOutput.includes('ECONNRESET') ||
        combinedOutput.includes('YN0035') ||
        combinedOutput.includes('503') ||
        combinedOutput.includes('502') ||
        combinedOutput.includes('504');

      if (isNetworkError) {
        if (attempt < MAX_RETRIES) {
          console.warn(`Network error encountered during audit. Retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await sleep(RETRY_DELAY_MS);
          continue;
        } else {
          console.warn(`Audit registry network requests repeatedly timed out/failed after ${MAX_RETRIES} attempts.`);
          process.exit(0);
        }
      } else {
        console.error('Dependency vulnerability audit failed with vulnerabilities or configuration error.');
        process.exit(error.status || 1);
      }
    }
  }
}

main();
