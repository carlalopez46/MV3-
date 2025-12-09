
const im_strre = "(?:\"(?:[^\"\\\\]|\\\\[0btnvfr\"'\\\\])*\"|" +
    "eval\\s*\\(\"(?:[^\"\\\\]|\\\\[\\w\"'\\\\])*\"\\)|" +
    "\\S*)";

const runRegex = new RegExp("^macro\\s*=\\s*(" + im_strre + ")\\s*$", "i");

function testRun(line) {
    const parts = line.trim().split(/\s+/);
    const cmdName = parts[0].toLowerCase();
    const params = line.substring(cmdName.length).trim();
    const match = params.match(runRegex);
    console.log(`Testing RUN: '${line}'`);
    if (match) {
        console.log("Match found!");
        console.log("1:", match[1]);
    } else {
        console.log("No match.");
    }
}

testRun("RUN MACRO=RUN_Test_Sub_Simple.iim");
