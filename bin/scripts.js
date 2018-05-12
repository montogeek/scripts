#!/usr/bin/env node

'use strict'

const path = require('path')
const fs = require('fs')
const glob = require('glob')
const sync = require('child_process').spawnSync
const { spawnSync } = require('npm-run')

const log = require('chalk')

const prettier = require('prettier')
const eslint = require('eslint')
const webpack = require('webpack')
const WebpackDevServer = require('webpack-dev-server')
const cosmiconfig = require('cosmiconfig')

const { GIT_PREFIX } = process.env
const isCommit = typeof GIT_PREFIX !== 'undefined'

const argv = process.argv.slice(2)
const script = isCommit ? 'check' : argv[0]
const args = new Set(argv.slice(1))
const isPersonal = args.has('--personal')

const appDirectory = GIT_PREFIX
  ? fs.realpathSync(GIT_PREFIX)
  : fs.realpathSync(process.cwd())
const resolveApp = relativePath => path.resolve(appDirectory, relativePath)

const webpackConfigFile = isPersonal ? 'webpack.config.personal.js' : 'webpack.config.js'
let appPackage = {}

try {
  appPackage = fs.readFileSync(resolveApp('package.json'), 'utf8')
} catch (e) {
  // Not running from a directory with package.json, exit silently
  process.exit(0)
}

appPackage = JSON.parse(appPackage)
const { NODE_ENV } = process.env

process.on('unhandledRejection', err => {
  throw err
})

// https://prettier.io/docs/en/options.html
const DEFAULT_PRETTIER_CONFIG = {
  semi: false,
  singleQuote: true,
  trailingComma: 'none',
  arrowParens: 'avoid'
}

function handleWebpackResults(error, stats) {
  if (error) {
    console.error(err.stack || err)
    if (err.details) {
      console.error(err.details)
    }
    return
  }

  const info = stats.toJson()

  if (stats.hasErrors()) {
    console.log(log.red(info.errors.join('\n')))
    process.exit(1)
  }

  if (stats.hasWarnings()) {
    console.log(log.yellow(info.warnings.join('\n')))
    process.exit(1)
  }

  console.log(
    stats.toString({
      chunks: false, // Makes the build much quieter
      colors: true // Shows colors in the console
    })
  )
}

function format() {
  console.log(log.blue('  > Checking formatting with Prettier'))
  let filesToFormat = `${appDirectory}/{src,config/local,personal,test}/**/*.js`
  const prettierConfig = cosmiconfig('prettier', { sync: true }).load()

  if (prettierConfig === null) {
    console.log(log.yellow('      Prettier not configured. Using default configuration'))
  } else {
    filesToFormat = prettierConfig.config.files
  }

  const files = glob.sync(filesToFormat, {})

  files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8')
    const valid = prettier.check(content, DEFAULT_PRETTIER_CONFIG)
    if (!valid) {
      console.log(log.white(`    You file ${file} format is incorrect!. Formatting it`))

      content = prettier.format(content, DEFAULT_PRETTIER_CONFIG)

      fs.writeFileSync(file, content)
    }
  })

  console.log(log.green('  Files correctly formatted.'))
}

function lint() {
  console.log(log.blue('  > Linting with ESLint'))

  var cli = new eslint.CLIEngine({
    cwd: appDirectory
  })

  const files = glob.sync(`${appDirectory}/src/**/*.js`)
  const formatter = cli.getFormatter('stylish')
  let runner

  try {
    runner = cli.executeOnFiles(files)
  } catch (e) {
    console.log(e)
    console.log(log.yellow('      ESLint not configured. Using default configuration'))
    process.exit(0)
  }

  // console.log(
  //   JSON.stringify(
  //     cli.getConfigForFile(path.join(appDirectory, 'src', 'main.js')),
  //     null,
  //     ' '
  //   )
  // )

  if (runner.errorCount > 0) {
    console.log(formatter(runner.results))
    process.exit(1)
  }
  console.log(log.green('  No lint errors.'))
  return
}

function test() {
  console.log(log.blue('  > Testing with Jest'))
  const jestConfig = appPackage.jest

  if (typeof jestConfig === 'undefined') {
    console.log(log.yellow('      Jest not configured, running your test script'))

    const script =
      (appPackage.scripts && appPackage.scripts.test && appPackage.scripts._test) ||
      undefined

    if (typeof script === 'undefined') {
      // Show another warning?
      process.exit(0)
    }

    const [cmd, args] = script.split(' ')

    const result = sync(cmd, [args])

    if (result.status !== 0) {
      process.stderr.write(result.stderr)
      process.exit(result.status)
    } else {
      process.stdout.write(result.stdout)
      process.stderr.write(result.stderr)
      console.log(log.green('  Test passed!'))
    }
  } else {
    let args = []
    args.push('--config', JSON.stringify(jestConfig))
    args.push('--color', '--verbose', '--bail')

    // We need to invoke Jest as a Node CLI command instead of using its Node API because
    // it is not possible to handle if it was successful or not
    const result = spawnSync('jest', args, { cwd: appDirectory })

    if (result.status !== 0) {
      process.stderr.write(result.stderr)
      process.exit(result.status)
    } else {
      process.stdout.write(result.stdout)
      process.stderr.write(result.stderr)
      console.log(log.green('  Test passed!'))
    }
  }
}

switch (script) {
  case 'build': {
    console.log(log.cyan.bold('Building your application'))

    format()
    lint()
    test()

    console.log(log.blue('  > Building application with webpack'))
    const webpackConfig = require(resolveApp(webpackConfigFile))('production')

    webpack(webpackConfig, (error, stats) => {
      handleWebpackResults(error, stats)
      console.log(log.bgGreen.bold('Build successful!'))
    })

    break
  }
  case 'check': {
    format()
    lint()
    test()

    break
  }
  case 'test': {
    console.log(log.cyan.bold('Testing your application'))

    test()

    break
  }
  case 'dev': {
    const webpackConfig = require(resolveApp(webpackConfigFile))('local')

    if (!isPersonal) {
      const { host, port } = webpackConfig.devServer

      const devServer = new WebpackDevServer(
        webpack(webpackConfig),
        webpackConfig.devServer
      )

      devServer.listen(port, host, err => {
        if (err) {
          return console.log(err)
        }

        console.log(
          log.cyan(`Starting the development server at http://${host}:${port}\n`)
        )
      })
      ;['SIGINT', 'SIGTERM'].forEach(function(sig) {
        process.on(sig, function() {
          devServer.close()
          process.exit()
        })
      })
    } else {
      webpack(webpackConfig, (error, stats) => {
        handleWebpackResults(error, stats)
        console.log(log.bgGreen.bold('Build successful!'))
      })
    }

    break
  }
  default: {
    console.log(log.blue('Please run one of the following commands: build, check, test, dev'))
    break
  }
}
