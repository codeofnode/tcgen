const { mkdirSync, createWriteStream } = require('fs-extra')
const { join } = require('path')

const noop = () => {}

/**
 * @module logger
 */

/**
 * A File Logger class, that logs to file
 * @class
 */
class FileLogger {
  /**
   * Create an instance of class FileLogger.
   * @param {String} logdir - the log directory, where logs to be stored
   * @param {String} [sourcePath] - the source files directory path
   * @param {String} [fileBaseName] - the base name of the log files
   */
  constructor (logdir, sourcePath = '', fileBaseName = '') {
    this.logdir = logdir
    try {
      mkdirSync(logdir)
    } catch (er) {
      // nothing to do
    }
    this.fileBaseName = fileBaseName
    this.sourcePath = sourcePath
    this.updateWriter()
  }

  /**
   * get current file name base on current date
   */
  getFileName () {
    return this.fileBaseName + String(new Date()).split(' ').slice(1, 4).join('_')
  }

  /**
   * that will assign the writer as per current date
   */
  updateWriter () {
    const fileName = this.getFileName()
    if (fileName !== this.fileName) {
      this.stop()
      this.fileName = fileName
      this.writer = createWriteStream(join(this.logdir, this.fileName), { flags: 'a', encoding: 'utf8' })
      this.writer.write(`{"type":"unit","require":"${join(this.sourcePath, this.fileBaseName)},"tests":[`)
    }
  }

  /**
   * stop the logger, end the file stream
   * @param {Function} [callback] - if found, to be called when the service is stopped
   */
  stop (callback = noop) {
    if (this.writer) {
      this.writer.end(']\n')
      callback()
    }
  }

  /**
   * The log handler, for all the test cases
   * @param {String} method - the method to be called
   * @param {Boolean} construct - whether the method call is a constructor
   * @param {Object} inInstance - the input instance
   * @param {*} inputParams - the input parameters array
   * @param {*} output - the output value
   */
  log (method, construct, inInstance, inputParams, output) {
    this.updateWriter()
    const str = JSON.stringify({
      require: inInstance,
      request: {
        payload: inputParams,
        construct,
        method
      },
      output
    }, null, 2)
    this.writer.write(`\n${str}`)
  }
}

module.exports = FileLogger
