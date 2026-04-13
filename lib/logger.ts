import fs from 'fs';
import path from 'path';

const logFile = path.join(process.cwd(), 'api-logs.txt');

export function logToFile(message: string) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  
  // Append to file
  fs.appendFileSync(logFile, logLine);
  
  // Also log to console
  console.log(message);
}

export function clearLogs() {
  if (fs.existsSync(logFile)) {
    fs.unlinkSync(logFile);
  }
}
