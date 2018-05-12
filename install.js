const execSync = require('child_process').execSync
const fs = require('fs')

function getGitRootDirectory() {
  try {
    return execSync('git rev-parse --show-toplevel')
      .toString()
      .trim()
  } catch (e) {
    return ''
  }
}

const preCommitFile = `${getGitRootDirectory()}/.git/hooks/pre-commit`

const script = fs.readFileSync('./pre-commit', 'utf8')

fs.writeFileSync(preCommitFile, script, 'utf-8')
fs.chmodSync(preCommitFile, parseInt('0755', 8))
