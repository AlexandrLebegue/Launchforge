import { autoPush } from "../src/services/pushAgent";

const message = process.argv[2] || "auto: commit changes";
const files = process.argv.slice(3);

const result = autoPush(message, files.length > 0 ? files : undefined);
console.log(JSON.stringify(result, null, 2));
process.exit(result.success ? 0 : 1);