const assert = require('assert')
const Mbjs = require('mbjs')
const { resolve, join, sep } = require('path')
const { mkdirpSync, statSync, readdirSync } = require('fs-extra')
const { tmpdir } = require('os')
const Executor = require('../executor')
const Logger = require('../logger')
const MODULE_CODE = require('../../package.json').name
const MODULE_CODE_UPPER = MODULE_CODE.toUpperCase()

/**
 * @module Tcgen
 */

/**
 * The Tcgen class
 * @class
 */
class Tcgen {
  /**
   * Create an instance of Tcgen class
   *
   * @param {Object} config the global app config options
   * @param {String} config.srcdir the root directory to instrument code for
   * @param {String} [config.destdir=`join(tmpdir, "tcgen", $modname)`] - the path where test cases will be written
   */
  constructor (config) {
    assert.strictEqual(typeof config, 'object', 'config MUST_BE_OBJECT')
    assert.strictEqual(typeof config.srcdir, 'string', 'srcdir MUST_BE_STRING')
    /** the code to be used as prefix for code etc
      * @member {String} */
    this.mainModuleCodeUpper = MODULE_CODE_UPPER
    /** the source directory to scan for code instrumentation
      * @member {String} */
    this.srcdir = config.srcdir
    /** the dest directory to save the test cases
      * @member {String} */
    this.destdir = config.destdir || join(tmpdir(), MODULE_CODE, this.srcdir.split(sep).slice(-3, -1)[0])
    assert.strictEqual(typeof this.srcdir, 'string', 'destdir MUST_BE_STRING')
    mkdirpSync(this.destdir)
    /** the function to throw error with code
      * @member {Function} */
    this.throwError = Mbjs.prototype.throwError.bind(this)
    /** the list of files to instrument
      * @member {String[]} */
    this.filelist = Tcgen.walkSync(this.srcdir)
  }

  /**
   * walking recursively in the directory, and capturing the file names
   * @param {String} dir - the path where source exists
   * @param {String} [ext=.js] - the extension of file to capture
   * @param {String[]} [filelist=[]] - list where files will be appended
   *
   * @return {String[]} the absolute path of the files
   */
  static walkSync (dir, ext = '.js', filelist = []) {
    const files = readdirSync(dir)
    let fls = filelist
    files.forEach((file) => {
      if (file !== '.') {
        if (statSync(join(dir, file)).isDirectory()) {
          fls = this.walkSync(join(dir, file), ext, fls)
        } else if (file.endsWith(ext)) {
          fls.push(join(dir, file))
        }
      }
    })
    return fls
  }

  /**
   * Set tcgen config from package.json config
   *
   * @param {Object|String} pkg the package config or its dir path
   *
   * @return {Object} returns the configuration found
   */
  static getConfigFromPkg (pkgVal) {
    assert.ok(['object', 'string'].includes(typeof pkgVal), 'name MUST_BE_OBJECT_OR_STRING')
    let pkg = pkgVal
    if (typeof pkg === 'string') {
      pkg = require(resolve(pkg, '..', 'package.json'))
    }
    return (pkg.config || {})[MODULE_CODE] || {}
  }

  /**
   * Clone premitive
   *
   * @param {*} input the input of which primitive to be cloned
   *
   * @returns {*} the cloned value
   */
  static clonePrimitive (input) {
    try {
      return JSON.parse(JSON.stringify(input))
    } catch (e) {
      return null
    }
  }

  /**
   * The main entry function of the tcgen
   *
   * @param {String} srcdir the root directory to instrument code for
   * @param {Object} [conf] the tcgen config to override
   *
   * @returns {Tcgen} the instance of Tcgen
   */
  static async main (srcdir, conf) {
    assert.strictEqual(typeof srcdir, 'string', 'srcdir MUST_BE_STRING')
    if (typeof conf !== 'object') {
      conf = Tcgen.getConfigFromPkg(srcdir)
    }
    conf.srcdir = srcdir
    const tcgen = new Tcgen(conf)
    tcgen.start()
    return tcgen
  }

  /**
   * Act as the middlemap to intercept the function under test
   * @param {Function} sLogger - the logger function
   * @param {*} ent - the input instance
   * @param {String} prop - method name belongs to ent
   * @param {Boolean} isConstructor - whether the function is constructor
   * @return {Function} the new function that will be used
   */
  static handleFunctionUnderTest (sLogger, ent, prop, isConstructor = false) {
    const applyArgs = [prop, isConstructor, Tcgen.clonePrimitive(ent)]
    /**
     * This becomes the original function
     * @param {...*} args - the arguments passed to be function
     */
    return function mainCall (...args) {
      applyArgs.push(args.map(Tcgen.clonePrimitive))
      const executor = new Executor(ent, prop, (err, ...data) => {
        if (err) {
          applyArgs.push({ error: Tcgen.clonePrimitive(err) })
        } else {
          applyArgs.push({ output: Tcgen.clonePrimitive(data.length > 1 ? data : data[0]) })
        }
        sLogger.apply(sLogger, applyArgs)
      }, isConstructor)
      executor.execute(...args)
      return executor.returnValue
    }
  }

  /**
   * instrument a class
   * @param {String} filePath - the path at which class is declared
   * @param {Function} cls - the class to be instrumented
   */
  instrumentClass (filePath, cls) {
    if (typeof cls !== 'function' || !cls || typeof cls.prototype !== 'object') return
    const srcPath = filePath.split(this.srcdir).pop().split(sep)
    const sLogger = new Logger(
      join(this.destdir, ...srcPath),
      srcPath.join(sep), filePath.split(sep).splice(-2, -1)[0]
    )
    Object.getOwnPropertyNames(cls).filter(p => typeof cls[p] === 'function').forEach((prop) => {
      if (Tcgen.ignoredStaticMethods.indexOf(prop) === -1) {
        cls[prop] = Tcgen.handleFunctionUnderTest(sLogger, cls[prop].bind(cls))
      }
    })
    Object.getOwnPropertyNames(cls.prototype).filter(p => typeof cls.prototype[p] === 'function').forEach((prop) => {
      cls.prototype[prop] = Tcgen.handleFunctionUnderTest(
        sLogger,
        cls.prototype[prop].bind(cls.prototype), prop === 'constructor'
      )
    })
  }

  /**
   * load and start instrument the modules
   *
   * @returns {Tcgen} the instance of Tcgen
   */
  start () {
    this.filelist.forEach((fl) => {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const loaded = require(fl)
      this.instrumentClass(fl, loaded)
      if (typeof loaded === 'object') {
        Object.entries(loaded).forEach(([ky, entry]) => {
          this.instrumentClass(fl, entry)
        })
      }
    })
    return this
  }
}

/** the static properties to ignore
 * @static
 * @member {String[]} */
Tcgen.ignoredStaticMethods = ['length', 'prototype', 'name']
module.exports = Tcgen
