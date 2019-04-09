const {app} = require('electron');
const chokidar = require('chokidar');
const fs = require('fs');
const {spawn} = require('child_process');
const path = require('path');

// Main file poses a special case, as its changes are
// only effective when the process is restarted (hard reset)
const appPath = app.getAppPath();
const config = require(path.join(appPath, 'package.json'));
const mainFile = path.join(appPath, config.main || 'index.js');
const ignoredPathsWithoutMain = [/node_modules|[/\\]\./];
const ignoredPaths = [mainFile, /node_modules|[/\\]\./];

/**
 * Creates a callback for hard resets.
 *
 * @param {String} eXecutable path to electron executable
 * @param {String} hardResetMethod method to restart electron
 * @returns {Function} handler to pass to chokidar
 */
const createHardresetHandler = (eXecutable, hardResetMethod, argv) =>
    () => {
        // Detaching child is useful when in Windows to let child
        // live after the parent is killed
        let args = (argv || []).concat([appPath])
        let child = spawn(eXecutable, args, {
            detached: true,
            stdio: 'inherit'
        })
        child.unref()
        // Kamikaze!

        // In cases where an app overrides the default closing or quiting actions
        // firing an `app.quit()` may not actually quit the app. In these cases
        // you can use `app.exit()` to gracefully close the app.
        if (hardResetMethod === 'exit') {
            app.exit()
        } else {
            app.quit()
        }
    };

/**
 * Creates main chokidar watcher for soft resets.
 *
 * @param {String|Array<String>} glob path, glob, or array to pass to chokidar
 * @param {Object} options chokidar options
 */
const createRendererProcessWatcher = (glob, options = {}) => {
    // Watch everything but the node_modules folder and main file
    // main file changes are only effective if hard reset is possible
    let opts = Object.assign({ignored: ignoredPaths}, options)
    return chokidar.watch(glob, opts)
};

const createMainProcessWatcher = (glob, options = {}) => {
    // Watch everything but the node_modules folder and main file
    // main file changes are only effective if hard reset is possible
    let opts = Object.assign({ignored: ignoredPathsWithoutMain}, options)
    return chokidar.watch(glob, opts)
};


class ElectronReload {

    constructor(glob, options = {}) {
        this._browserWindows = [];
        this._watcher = createRendererProcessWatcher(glob, options);
        this._hardWatcher = createMainProcessWatcher(mainFile, options);

        // II) hard reset: restart the whole electron process
        this._eXecutable = options.electron;
        this._hardResetHandler = createHardresetHandler(this._eXecutable, options.hardResetMethod, options.argv);

        // Add each created BrowserWindow to list of maintained items
        app.on('browser-window-created', (e, bw) => {
            this._browserWindows.push(bw);

            // Remove closed windows from list of maintained items
            bw.on('closed', function () {
                const i = this._browserWindows.indexOf(bw); // Must use current index
                this._browserWindows.splice(i, 1);
            })
        })

        // Enable default soft reset
        if(options.customSoftResetHandler) {
            this._watcher.on('change', () => {
                options.customSoftResetHandler(this._browserWindows);
            });
        } else {
            this._softResetHandler = () => browserWindows.forEach(bw => {
                bw.webContents.reloadIgnoringCache()
            });
            this._watcher.on('change', this._softResetHandler);
        }

        // Preparing hard reset if electron executable is given in options
        // A hard reset is only done when the main file has changed
        if (this._eXecutable && fs.existsSync(this._eXecutable)) {
            if (options.forceHardReset === true) {
                // Watch every file for hard reset and not only the main file
                this._hardWatcher.add(glob);
                // Stop our default soft reset
                this._watcher.close();
            }

            this._hardWatcher.on('change', this._hardResetHandler)
        } else {
            console.log('Electron could not be found. No hard resets for you!')
        }
    }
}

module.exports = ElectronReload;
