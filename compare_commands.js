const fs = require('fs');
const path = require('path');

const oldFile = path.join(__dirname, 'old_file', 'mplayer.js');
const newFile = path.join(__dirname, 'mplayer.js');

function extractCommands(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const regex = /RegExpTable\["([^"]+)"\]/g;
        const commands = new Set();
        let match;
        while ((match = regex.exec(content)) !== null) {
            commands.add(match[1]);
        }
        return commands;
    } catch (e) {
        console.error(`Error reading ${filePath}:`, e);
        return new Set();
    }
}

const oldCommands = extractCommands(oldFile);
const newCommands = extractCommands(newFile);

console.log('--- Commands in OLD file ---');
console.log([...oldCommands].sort().join(', '));

console.log('\n--- Commands in NEW file ---');
console.log([...newCommands].sort().join(', '));

console.log('\n--- Missing Commands in NEW file ---');
const missing = [...oldCommands].filter(cmd => !newCommands.has(cmd));
console.log(missing.sort().join(', '));
