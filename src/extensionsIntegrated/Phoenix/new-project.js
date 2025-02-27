/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
 * for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see https://opensource.org/licenses/AGPL-3.0.
 *
 */

/*global Phoenix*/

define(function (require, exports, module) {
    const Dialogs = require("widgets/Dialogs"),
        Mustache = require("thirdparty/mustache/mustache"),
        newProjectTemplate = require("text!./html/new-project-template.html"),
        Strings = require("strings"),
        StringUtils = require("utils/StringUtils"),
        ExtensionInterface = require("utils/ExtensionInterface"),
        CommandManager = require("command/CommandManager"),
        Commands = require("command/Commands"),
        Menus = require("command/Menus"),
        Metrics = require("utils/Metrics"),
        DefaultDialogs = require("widgets/DefaultDialogs"),
        FileSystem = require("filesystem/FileSystem"),
        FileUtils = require("file/FileUtils"),
        ZipUtils = require("utils/ZipUtils"),
        ProjectManager = require("project/ProjectManager"),
        EventDispatcher     = require("utils/EventDispatcher"),
        DocumentCommandHandlers = require("document/DocumentCommandHandlers"),
        createProjectDialogue = require("text!./html/create-project-dialogue.html"),
        replaceProjectDialogue = require("text!./html/replace-project-dialogue.html"),
        replaceKeepProjectDialogue = require("text!./html/replace-keep-project-dialogue.html"),
        guidedTour = require("./guided-tour");

    EventDispatcher.makeEventDispatcher(exports);

    const NEW_PROJECT_INTERFACE = "Extn.Phoenix.newProject",
        MAX_DEDUPE_COUNT = 10000;

    ExtensionInterface.registerExtensionInterface(NEW_PROJECT_INTERFACE, exports);

    let newProjectDialogueObj,
        createProjectDialogueObj,
        downloadCancelled = false;

    function _showNewProjectDialogue() {
        if(window.testEnvironment){
            return;
        }
        let templateVars = {
            Strings: Strings,
            newProjectURL: `${window.Phoenix.baseURL}assets/new-project/code-editor.html`
        };
        let dialogueContents = Mustache.render(newProjectTemplate, templateVars);
        newProjectDialogueObj = Dialogs.showModalDialogUsingTemplate(dialogueContents, true);
        setTimeout(()=>{
            document.getElementById("newProjectFrame").contentWindow.focus();
        }, 100);
        Metrics.countEvent(Metrics.EVENT_TYPE.NEW_PROJECT, "dialogue", "open");
    }

    function _addMenuEntries() {
        CommandManager.register(Strings.CMD_PROJECT_NEW, Commands.FILE_NEW_PROJECT, _showNewProjectDialogue);
        const fileMenu = Menus.getMenu(Menus.AppMenuBar.FILE_MENU);
        fileMenu.addMenuItem(Commands.FILE_NEW_PROJECT, "", Menus.AFTER, Commands.FILE_NEW_FOLDER);
    }

    function closeDialogue() {
        Metrics.countEvent(Metrics.EVENT_TYPE.NEW_PROJECT, "dialogue", "close");
        newProjectDialogueObj.close();
        exports.trigger(exports.EVENT_NEW_PROJECT_DIALOGUE_CLOSED);
        guidedTour.startTourIfNeeded();
    }

    function showErrorDialogue(title, message) {
        Dialogs.showModalDialog(
            DefaultDialogs.DIALOG_ID_ERROR,
            title,
            message
        );
    }

    function openFolder () {
        CommandManager.execute(Commands.FILE_OPEN_FOLDER).then(closeDialogue);
    }

    async function _shouldNotShowDialog() {
        if(!Phoenix.browser.isTauri){
            // in browser we always show the new project dialog even if there is a different startup project open. This
            // is mainly for users to discover the download native app button in the new project window.
            return false;
        }
        // in tauri, we don't show the dialog if its not default project or
        // if phoenix was opened with a file/folder from os with cli args. In mac, this is done via
        // setSingleInstanceCLIArgsHandler as it doesnt use cli args for open with like other os.
        if(ProjectManager.getProjectRoot().fullPath !== ProjectManager.getWelcomeProjectPath() ||
            DocumentCommandHandlers._isOpenWithFileFromOS()){
            return true;
        }
        // we are in the default project, show the dialog only if we are not opened with a file
        const cliArgs= await Phoenix.app.getCommandLineArgs();
        const args = cliArgs && cliArgs.args;
        if(!args || args.length <= 1){
            return false;
        }
        return true;
    }

    function init() {
        _addMenuEntries();
        const shouldShowWelcome = PhStore.getItem("new-project.showWelcomeScreen") || 'Y';
        if(shouldShowWelcome !== 'Y') {
            Metrics.countEvent(Metrics.EVENT_TYPE.NEW_PROJECT, "dialogue", "disabled");
            guidedTour.startTourIfNeeded();
            return;
        }
        _shouldNotShowDialog()
            .then(notShow=>{
                if(notShow){
                    return;
                }
                _showNewProjectDialogue();
                DocumentCommandHandlers.on(DocumentCommandHandlers._EVENT_OPEN_WITH_FILE_FROM_OS, ()=>{
                    closeDialogue();
                });
            });
    }

    function _showProjectErrorDialogue(desc, projectPath, err) {
        let message = StringUtils.format(desc, projectPath, err);
        showErrorDialogue(Strings.ERROR_LOADING_PROJECT, message);
    }

    function _showReplaceProjectConfirmDialogue(projectPath) {
        let message = StringUtils.format(Strings.DIRECTORY_REPLACE_MESSAGE, projectPath);
        let templateVars = {
            Strings: Strings,
            MESSAGE: message
        };
        return Dialogs.showModalDialogUsingTemplate(Mustache.render(replaceProjectDialogue, templateVars));
    }

    function _showReplaceKeepProjectConfirmDialogue(projectPath) {
        let message = StringUtils.format(Strings.DIRECTORY_REPLACE_MESSAGE, projectPath);
        let templateVars = {
            Strings: Strings,
            MESSAGE: message
        };
        return Dialogs.showModalDialogUsingTemplate(Mustache.render(replaceKeepProjectDialogue, templateVars));
    }

    function _checkIfPathIsWritable(path) {
        // this is needed as for fs access APIs in native folders, the browser will ask an additional write permission
        // to the user. We have to validate that before proceeding.
        // We do this by writing a file `.phcode.json` to the folder
        return new Promise((resolve, reject)=>{
            let file = FileSystem.getFileForPath(`${path}/.phcode.json`);
            FileUtils.writeText(file, "{}", true)
                .done(resolve)
                .fail(reject);
        });
    }

    async function _validateProjectFolder(projectPath) {
        return new Promise((resolve, reject)=>{
            let dir = FileSystem.getDirectoryForPath(projectPath);
            let displayPath = projectPath.replace(Phoenix.VFS.getMountDir(), "");
            if(!dir){
                _showProjectErrorDialogue(Strings.REQUEST_NATIVE_FILE_SYSTEM_ERROR, displayPath, Strings.NOT_FOUND_ERR);
                reject();
            }
            dir.getContents(function (err, contents) {
                if (err) {
                    _showProjectErrorDialogue(Strings.READ_DIRECTORY_ENTRIES_ERROR, displayPath, Strings.NOT_FOUND_ERR);
                    reject();
                    return;
                }
                function _resolveIfWritable() {
                    _checkIfPathIsWritable(projectPath)
                        .then(resolve)
                        .catch(reject);
                }
                if(contents.length >0){
                    _showReplaceProjectConfirmDialogue(displayPath).done(function (id) {
                        if (id === Dialogs.DIALOG_BTN_OK) {
                            _resolveIfWritable();
                            return;
                        }
                        reject();
                    });
                } else {
                    _resolveIfWritable();
                }
            });
        });
    }

    async function _findFreeFolderName(basePath) {
        return new Promise(async (resolve, reject)=>{ // eslint-disable-line
            try {
                for(let i=0; i< MAX_DEDUPE_COUNT; i++){
                    let newPath = `${basePath}-${i}`;
                    let exists = await window.Phoenix.VFS.existsAsync(newPath);
                    if(!exists){
                        await window.Phoenix.VFS.ensureExistsDirAsync(newPath);
                        resolve(newPath);
                        return;
                    }
                }
                reject();
            } catch (e) {
                reject(e);
            }
        });
    }

    async function alreadyExists(suggestedProjectName) {
        let projectPath = `${ProjectManager.getLocalProjectsPath()}${suggestedProjectName}`; // try suggested path first
        return window.Phoenix.VFS.existsAsync(projectPath);
    }

    async function _getSuggestedProjectDir(suggestedProjectName) {
        return new Promise(async (resolve, reject)=>{ // eslint-disable-line
            try{
                // try suggested path first
                let projectPath = `${ProjectManager.getLocalProjectsPath()}${suggestedProjectName}`;
                let exists = await window.Phoenix.VFS.existsAsync(projectPath);
                if(!exists){
                    resolve(projectPath);
                    return;
                }
                _showReplaceKeepProjectConfirmDialogue(suggestedProjectName).done(function (id) {
                    if (id === Dialogs.DIALOG_BTN_OK) {
                        resolve(projectPath);
                        return;
                    } else if(id === Dialogs.DIALOG_BTN_CANCEL){
                        reject();
                        return;
                    }
                    _findFreeFolderName(projectPath)
                        .then(projectPath=>resolve(projectPath))
                        .catch(reject);
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    function _showCreateProjectDialogue(title, message) {
        let templateVars = {
            Strings: Strings,
            TITLE: title,
            MESSAGE: message
        };
        createProjectDialogueObj=
            Dialogs.showModalDialogUsingTemplate(Mustache.render(createProjectDialogue, templateVars));
        return createProjectDialogueObj;
    }

    function _closeCreateProjectDialogue() {
        createProjectDialogueObj.close();
    }

    function _updateCreateProjectDialogueMessage(message, title) {
        let el = document.getElementById('new-prj-msg-dlg-message');
        if(el){
            el.textContent = message;
        }
        el = document.getElementById('new-prj-msg-dlg-title');
        if(el && title){
            el.textContent = title;
        }
    }

    function _unzipProject(data, projectPath, flattenFirstLevelInZip, progressCb) {
        return new Promise((resolve, reject)=>{
            _updateCreateProjectDialogueMessage(Strings.UNZIP_IN_PROGRESS, Strings.DOWNLOAD_COMPLETE);
            ZipUtils.unzipBinDataToLocation(data, projectPath, flattenFirstLevelInZip, progressCb)
                .then(resolve)
                .catch(reject);
        });
    }

    /**
     *
     * @param downloadURL
     * @param projectPath
     * @param suggestedProjectName
     * @param flattenFirstLevelInZip if set to true, then if zip contents are nested inside a directory, the nexted dir
     * will be removed in the path structure in destination. For Eg. some Zip may contain a `contents` folder inside the
     * zip which has all the contents. If we blindly extract the zio, all the contents will be placed inside a
     * `contents` folder in root and not the root dir itself.
     * See a sample zip file here: https://api.github.com/repos/StartBootstrap/startbootstrap-grayscales/zipball
     * @returns {Promise<void>}
     */
    async function downloadAndOpenProject(downloadURL, projectPath, suggestedProjectName, flattenFirstLevelInZip) {
        return new Promise(async (resolve, reject)=>{ // eslint-disable-line
            try {
                // if project path is null, create one in default folder
                if(!projectPath){
                    projectPath = await _getSuggestedProjectDir(suggestedProjectName);
                } else {
                    await _validateProjectFolder(projectPath);
                }
                console.log(
                    `downloadAndOpenProject ${suggestedProjectName} from URL: ${downloadURL} to: ${projectPath}`);

                downloadCancelled = false;
                _showCreateProjectDialogue(Strings.SETTING_UP_PROJECT, Strings.DOWNLOADING).done(function (id) {
                    if (id === Dialogs.DIALOG_BTN_CANCEL) {
                        downloadCancelled = true;
                    }
                });
                window.JSZipUtils.getBinaryContent(downloadURL, {
                    callback: async function(err, data) {
                        if(downloadCancelled){
                            reject();
                        } else if(err) {
                            console.error("could not load phoenix default project from zip file!", err);
                            _closeCreateProjectDialogue();
                            showErrorDialogue(Strings.DOWNLOAD_FAILED, Strings.DOWNLOAD_FAILED_MESSAGE);
                            reject();
                        } else {
                            function _progressCB(done, total) {
                                let message = StringUtils.format(Strings.EXTRACTING_FILES_PROGRESS, done, total);
                                _updateCreateProjectDialogueMessage(message);
                                return !downloadCancelled; // continueExtraction id not download cancelled
                            }
                            _unzipProject(data, projectPath, flattenFirstLevelInZip, _progressCB)
                                .then(()=>{
                                    _closeCreateProjectDialogue();
                                    ProjectManager.openProject(projectPath)
                                        .then(resolve)
                                        .fail(reject);
                                    console.log("Project Setup complete: ", projectPath);
                                })
                                .catch(()=>{
                                    _closeCreateProjectDialogue();
                                    showErrorDialogue(Strings.ERROR_LOADING_PROJECT, Strings.UNZIP_FAILED);
                                    reject();
                                });
                        }
                    },
                    progress: function (status){
                        if(status.percent > 0){
                            _updateCreateProjectDialogueMessage(
                                `${Strings.DOWNLOADING} ${Math.round(status.percent)}%`);
                        }
                    },
                    abortCheck: function (){
                        return downloadCancelled;
                    }
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    function showFolderSelect() {
        return new Promise((resolve, reject)=>{
            FileSystem.showOpenDialog(false, true, Strings.CHOOSE_FOLDER, '', null, function (err, files) {
                if(err || files.length !== 1){
                    reject();
                    return;
                }
                resolve(files[0]);
            });
        });
    }

    function showAboutBox() {
        CommandManager.execute(Commands.HELP_ABOUT);
    }

    exports.init = init;
    exports.openFolder = openFolder;
    exports.closeDialogue = closeDialogue;
    exports.downloadAndOpenProject = downloadAndOpenProject;
    exports.showFolderSelect = showFolderSelect;
    exports.showErrorDialogue = showErrorDialogue;
    exports.alreadyExists = alreadyExists;
    exports.Metrics = Metrics;
    exports.EVENT_NEW_PROJECT_DIALOGUE_CLOSED = "newProjectDlgClosed";
    exports.getWelcomeProjectPath = ProjectManager.getWelcomeProjectPath;
    exports.getExploreProjectPath = ProjectManager.getExploreProjectPath;
    exports.getLocalProjectsPath = ProjectManager.getLocalProjectsPath;
    exports.getMountDir = Phoenix.VFS.getMountDir;
    exports.path = Phoenix.path;
    exports.getTauriDir = Phoenix.VFS.getTauriDir;
    exports.getTauriPlatformPath = Phoenix.fs.getTauriPlatformPath;
    exports.showAboutBox = showAboutBox;
});
