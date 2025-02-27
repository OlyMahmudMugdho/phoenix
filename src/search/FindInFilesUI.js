/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2014 - 2021 Adobe Systems Incorporated. All rights reserved.
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

/*
 * UI and controller logic for find/replace across multiple files within the project.
 *
 * FUTURE:
 *  - Handle matches that span multiple lines
 */
define(function (require, exports, module) {


    const AppInit           = require("utils/AppInit"),
        CommandManager    = require("command/CommandManager"),
        Commands          = require("command/Commands"),
        Dialogs           = require("widgets/Dialogs"),
        DefaultDialogs    = require("widgets/DefaultDialogs"),
        EditorManager     = require("editor/EditorManager"),
        WorkspaceManager  = require("view/WorkspaceManager"),
        FileFilters       = require("search/FileFilters"),
        FileUtils         = require("file/FileUtils"),
        FindBar           = require("search/FindBar").FindBar,
        FindInFiles       = require("search/FindInFiles"),
        FindUtils         = require("search/FindUtils"),
        InMemoryFile      = require("document/InMemoryFile"),
        ProjectManager    = require("project/ProjectManager"),
        SearchResultsView = require("search/SearchResultsView").SearchResultsView,
        TaskManager  = require("features/TaskManager"),
        Strings           = require("strings"),
        StringUtils       = require("utils/StringUtils"),
        Metrics           = require("utils/Metrics"),
        _                 = require("thirdparty/lodash");

    let searchTask;

    /** @const Maximum number of files to do replacements in-memory instead of on disk. */
    var MAX_IN_MEMORY = 20;

    /** @type {SearchResultsView} The results view. Initialized in htmlReady() */
    var _resultsView = null;

    /** @type {FindBar} Find bar containing the search UI. */
    var _findBar = null;

    /**
     * @private
     * Forward declaration for JSLint.
     * @type {Function}
     */
    var _finishReplaceBatch;

    function _hideBusyIndicator() {
        if(searchTask){
            searchTask.close();
            searchTask=null;
        }
    }

    function _showBusyIndicator(scope) {
        if(searchTask){
            searchTask.close();
        }
        let scopeName = scope ?
            Phoenix.app.getDisplayPath(scope.fullPath) :
            Phoenix.app.getDisplayPath(ProjectManager.getProjectRoot().fullPath);
        scopeName = StringUtils.format(Strings.FIND_IN_FILES_SEARCHING_IN, scopeName);
        searchTask = TaskManager.addNewTask(Strings.FIND_IN_FILES_SEARCHING, scopeName,
            `<i class="fa-solid fa-magnifying-glass"></i>`);
    }

    /**
     * Does a search in the given scope with the given filter. Shows the result list once the search is complete.
     * @param {{query: string, caseSensitive: boolean, isRegexp: boolean}} queryInfo Query info object
     * @param {?Entry} scope Project file/subfolder to search within; else searches whole project.
     * @param {?string} filter A "compiled" filter as returned by FileFilters.compile(), or null for no filter
     * @param {?string} replaceText If this is a replacement, the text to replace matches with.
     * @param {?$.Promise} candidateFilesPromise If specified, a promise that should resolve with the same set of files that
     *      getCandidateFiles(scope) would return.
     * @return {$.Promise} A promise that's resolved with the search results or rejected when the find competes.
     */
    function searchAndShowResults(queryInfo, scope, filter, replaceText, candidateFilesPromise) {
        return FindInFiles.doSearchInScope(queryInfo, scope, filter, replaceText, candidateFilesPromise)
            .done(function (zeroFilesToken) {
                // Done searching all files: show results
                if (FindInFiles.searchModel.hasResults()) {
                    _resultsView.open();

                    if (_findBar) {
                        _findBar.enable(true);
                        _findBar.focus();
                    }

                } else {
                    _resultsView.close();

                    if (_findBar) {
                        var showMessage = false;
                        _findBar.enable(true);
                        if (zeroFilesToken === FindInFiles.ZERO_FILES_TO_SEARCH) {
                            _findBar.showError(StringUtils.format(Strings.FIND_IN_FILES_ZERO_FILES,
                                FindUtils.labelForScope(FindInFiles.searchModel.scope)), true);
                        } else {
                            showMessage = true;
                        }
                        _findBar.showNoResults(true, showMessage);
                    }
                }

                _hideBusyIndicator();
            })
            .fail(function (err) {
                console.log("find in files failed: ", err);
                _hideBusyIndicator();
            });
    }

    /**
     * Does a search in the given scope with the given filter. Replace the result list once the search is complete.
     * @param {{query: string, caseSensitive: boolean, isRegexp: boolean}} queryInfo Query info object
     * @param {?Entry} scope Project file/subfolder to search within; else searches whole project.
     * @param {?string} filter A "compiled" filter as returned by FileFilters.compile(), or null for no filter
     * @param {?string} replaceText If this is a replacement, the text to replace matches with.
     * @param {?$.Promise} candidateFilesPromise If specified, a promise that should resolve with the same set of files that
     *      getCandidateFiles(scope) would return.
     * @return {$.Promise} A promise that's resolved with the search results or rejected when the find competes.
     */
    function searchAndReplaceResults(queryInfo, scope, filter, replaceText, candidateFilesPromise) {
        return FindInFiles.doSearchInScope(queryInfo, scope, filter, replaceText, candidateFilesPromise)
            .done(function (zeroFilesToken) {
                // Done searching all files: replace all
                if (FindInFiles.searchModel.hasResults()) {
                    _finishReplaceBatch(FindInFiles.searchModel);

                    if (_findBar) {
                        _findBar.enable(true);
                        _findBar.focus();
                    }

                }
                _hideBusyIndicator();
            })
            .fail(function (err) {
                console.log("replace all failed: ", err);
                _hideBusyIndicator();
            });
    }

    /**
     * @private
     * Displays a non-modal embedded dialog above the code mirror editor that allows the user to do
     * a find operation across all files in the project.
     * @param {?Entry} scope  Project file/subfolder to search within; else searches whole project.
     * @param {boolean=} showReplace If true, show the Replace controls.
     */
    function _showFindBar(scope, showReplace) {
        FindUtils.notifySearchScopeChanged();
        // If the scope is a file with a custom viewer, then we
        // don't show find in files dialog.
        if (scope && !EditorManager.canOpenPath(scope.fullPath)) {
            return;
        }

        if (scope instanceof InMemoryFile) {
            CommandManager.execute(Commands.FILE_OPEN, { fullPath: scope.fullPath }).done(function () {
                CommandManager.execute(Commands.CMD_FIND);
            });
            return;
        }

        // Get initial query/replace text
        let currentEditor = EditorManager.getActiveEditor();
        let focussedEditor = EditorManager.getFocusedEditor();
        if(!focussedEditor && _resultsView._$previewEditor && _resultsView._$previewEditor.editor
            && _resultsView._$previewEditor.editor.hasFocus()){
            currentEditor =  _resultsView._$previewEditor.editor;
        }

        let initialQuery = FindBar.getInitialQuery(_findBar, currentEditor);

        // Close our previous find bar, if any. (The open() of the new _findBar will
        // take care of closing any other find bar instances.)
        if (_findBar) {
            _findBar.close();
        }

        _findBar = new FindBar({
            multifile: true,
            replace: showReplace,
            initialQuery: initialQuery.query,
            initialReplaceText: initialQuery.replaceText,
            queryPlaceholder: Strings.FIND_QUERY_PLACEHOLDER,
            scopeLabel: FindUtils.labelForScope(scope)
        });
        _findBar.open();

        // TODO Should push this state into ModalBar (via a FindBar API) instead of installing a callback like this.
        // Custom closing behavior: if in the middle of executing search, blur shouldn't close ModalBar yet. And
        // don't close bar when opening Edit Filter dialog either.
        _findBar._modalBar.isLockedOpen = function () {
            // TODO: should have state for whether the search is executing instead of looking at find bar state
            // TODO: should have API on filterPicker to figure out if dialog is open
            return !_findBar.isEnabled() || $(".modal.instance .exclusions-editor").length > 0;
        };

        var candidateFilesPromise = FindInFiles.getCandidateFiles(scope),  // used for eventual search, and in exclusions editor UI
            filterPicker;

        function handleQueryChange() {
            // Check the query expression on every input event. This way the user is alerted
            // to any RegEx syntax errors immediately.
            var queryInfo = _findBar.getQueryInfo(),
                queryResult = FindUtils.parseQueryInfo(queryInfo);

            // Enable the replace button appropriately.
            _findBar.enableReplace(queryResult.valid);

            if (queryResult.valid || queryResult.empty) {
                _findBar.showNoResults(false);
                _findBar.showError(null);
            } else {
                _findBar.showNoResults(true, false);
                _findBar.showError(queryResult.error);
            }
        }

        function startSearch(replaceText) {
            var queryInfo = _findBar.getQueryInfo(),
                disableFindBar = (replaceText ? true : false);
            if (queryInfo && queryInfo.query) {
                _findBar.enable(!disableFindBar);
                _showBusyIndicator(scope);
                let queryType = "query";
                if (queryInfo.isRegexp) {
                    queryType = queryType + ":regex";
                }
                if (queryInfo.isCaseSensitive) {
                    queryType = queryType + ":caseSensitive";
                }
                Metrics.countEvent(Metrics.EVENT_TYPE.SEARCH, "findInFiles", queryType);

                var filter;
                if (filterPicker) {
                    filter = FileFilters.commitPicker(filterPicker);
                } else {
                    // Single-file scope: don't use any file filters
                    filter = null;
                }
                searchAndShowResults(queryInfo, scope, filter, replaceText, candidateFilesPromise);
            }
            return null;
        }

        function startReplace() {
            startSearch(_findBar.getReplaceText());
        }

        _findBar
            .on("doFind.FindInFiles", function () {
                // Subtle issue: we can't just pass startSearch directly as the handler, because
                // we don't want it to get the event object as an argument.
                startSearch();
            })
            .on("queryChange.FindInFiles", handleQueryChange)
            .on("close.FindInFiles", function (e) {
                _findBar.off(".FindInFiles");
                _findBar = null;
            })
            .on("selectNextResult", function () {
                if (_findBar && _findBar._options.multifile){
                    _resultsView.selectNextResult();
                }
            })
            .on("selectPrevResult", function () {
                if (_findBar && _findBar._options.multifile){
                    _resultsView.selectPrevResult();
                }
            })
            .on("selectNextPage", function () {
                if (_findBar && _findBar._options.multifile){
                    _resultsView.selectNextPage();
                }
            })
            .on("selectPrevPage", function () {
                if (_findBar && _findBar._options.multifile){
                    _resultsView.selectPrevPage();
                }
            })
            .on("openSelectedFile", function () {
                if (_findBar && _findBar._options.multifile){
                    _resultsView.OpenSelectedFile();
                }
            });

        if (showReplace) {
            // We shouldn't get a "doReplace" in this case, since the Replace button
            // is hidden when we set options.multifile.
            _findBar.on("doReplaceBatch.FindInFiles", startReplace);
        }

        var oldModalBarHeight = _findBar._modalBar.height();

        // Show file-exclusion UI *unless* search scope is just a single file
        if (!scope || scope.isDirectory) {
            var exclusionsContext = {
                label: FindUtils.labelForScope(scope),
                promise: candidateFilesPromise
            };

            filterPicker = FileFilters.createFilterPicker(exclusionsContext);
            // TODO: include in FindBar? (and disable it when FindBar is disabled)
            _findBar._modalBar.getRoot().find(".scope-group").append(filterPicker);
        }

        handleQueryChange();
        startSearch();

        // Appending FilterPicker and query text can change height of modal bar, so resize editor.
        // Preserve scroll position of the current full editor across the editor refresh, adjusting
        // for the height of the modal bar so the code doesn't appear to shift if possible.
        var fullEditor = EditorManager.getCurrentFullEditor(),
            scrollPos;
        if (fullEditor) {
            scrollPos = fullEditor.getScrollPos();
            scrollPos.y -= oldModalBarHeight;   // modalbar already showing, adjust for old height
        }
        WorkspaceManager.recomputeLayout();
        if (fullEditor) {
            fullEditor._codeMirror.scrollTo(scrollPos.x, scrollPos.y + _findBar._modalBar.height());
        }
    }

    /**
     * @private
     * Finish a replace across files operation when the user clicks "Replace" on the results panel.
     * @param {SearchModel} model The model for the search associated with ths replace.
     */
    function _finishReplaceBatch(model) {
        var replaceText = model.replaceText;
        if (replaceText === null) {
            return;
        }

        // Clone the search results so that they don't get updated in the middle of the replacement.
        var resultsClone = _.cloneDeep(model.results),
            replacedFiles = Object.keys(resultsClone).filter(function (path) {
                return FindUtils.hasCheckedMatches(resultsClone[path]);
            }),
            isRegexp = model.queryInfo.isRegexp;

        function processReplace(forceFilesOpen) {
            _showBusyIndicator(model.scope);
            FindInFiles.doReplace(resultsClone, replaceText, { forceFilesOpen: forceFilesOpen, isRegexp: isRegexp })
                .fail(function (errors) {
                    var message = Strings.REPLACE_IN_FILES_ERRORS + FileUtils.makeDialogFileList(
                            errors.map(function (errorInfo) {
                                return ProjectManager.makeProjectRelativeIfPossible(errorInfo.item);
                            })
                        );

                    Dialogs.showModalDialog(
                        DefaultDialogs.DIALOG_ID_ERROR,
                        Strings.REPLACE_IN_FILES_ERRORS_TITLE,
                        message,
                        [
                            {
                                className: Dialogs.DIALOG_BTN_CLASS_PRIMARY,
                                id: Dialogs.DIALOG_BTN_OK,
                                text: Strings.BUTTON_REPLACE_WITHOUT_UNDO
                            }
                        ]
                    );
                })
                .always(function () {
                    _hideBusyIndicator();
                });
        }

        if (replacedFiles.length <= MAX_IN_MEMORY) {
            // Just do the replacements in memory.
            _resultsView.close();
            processReplace(true);
        } else {
            Dialogs.showModalDialog(
                DefaultDialogs.DIALOG_ID_INFO,
                Strings.REPLACE_WITHOUT_UNDO_WARNING_TITLE,
                StringUtils.format(Strings.REPLACE_WITHOUT_UNDO_WARNING, MAX_IN_MEMORY),
                [
                    {
                        className: Dialogs.DIALOG_BTN_CLASS_NORMAL,
                        id: Dialogs.DIALOG_BTN_CANCEL,
                        text: Strings.CANCEL
                    },
                    {
                        className: Dialogs.DIALOG_BTN_CLASS_PRIMARY,
                        id: Dialogs.DIALOG_BTN_OK,
                        text: Strings.BUTTON_REPLACE_WITHOUT_UNDO
                    }
                ]
            )
                .done(function (id) {
                    if (id === Dialogs.DIALOG_BTN_OK) {
                        _resultsView.close();
                        processReplace(false);
                    }
                });
        }
    }

    // Command handlers

    /**
     * @private
     * Bring up the Find in Files UI with the replace options.
     */
    function _showReplaceBar() {
        FindUtils.notifySearchScopeChanged();
        _showFindBar(null, true);
    }

    /**
     * @private
     * Search within the file/subtree defined by the sidebar selection
     */
    function _showFindBarForSubtree() {
        FindUtils.notifySearchScopeChanged();
        var selectedEntry = ProjectManager.getSelectedItem();
        _showFindBar(selectedEntry);
    }

    /**
     * @private
     * Search within the file/subtree defined by the sidebar selection
     */
    function _showReplaceBarForSubtree() {
        FindUtils.notifySearchScopeChanged();
        var selectedEntry = ProjectManager.getSelectedItem();
        _showFindBar(selectedEntry, true);
    }

    /**
     * @private
     * Close the open search bar, if any. For unit tests.
     */
    function _closeFindBar() {
        if (_findBar) {
            _findBar.close();
        }
    }

    /**
     * When the search indexing is started, we need to show the indexing status on the find bar if present.
     */
    function _searchIndexingStarted() {
        if (_findBar && _findBar._options.multifile && FindUtils.isIndexingInProgress()) {
            _findBar.showIndexingSpinner();
        }
    }

    /**
     * When the search indexing is started, we need to show the indexing status on the find bar if present.
     */
    function _searchIndexingProgressing(_evt, processed, total) {
        if (_findBar && _findBar._options.multifile && FindUtils.isIndexingInProgress()) {
            let progressMessage = StringUtils.format(Strings.FIND_IN_FILES_INDEXING_PROGRESS, processed, total);
            _findBar.setIndexingMessage(progressMessage);
        }
    }

    /**
     * Once the indexing has finished, clear the indexing spinner
     */
    function _searchIndexingFinished() {
        if (_findBar) {
            _findBar.hideIndexingSpinner();
        }
    }

    /**
     * Issues a search if find bar is visible and is multi file search and not instant search
     */
    function _defferedSearch() {
        if (_findBar && _findBar._options.multifile && !_findBar._options.replace) {
            _findBar.redoInstantSearch();
        }
    }

    /**
     * Schedules a search on search scope/filter changes. Have to schedule as when we listen to this event, the file filters
     * might not have been updated yet.
     */
    function _searchIfRequired() {
        if (!FindUtils.isInstantSearchDisabled() && _findBar && _findBar._options.multifile && !_findBar._options.replace) {
            setTimeout(_defferedSearch, 100);
        }
    }

    /**
    * @public
    * Closes the search results panel
    */
    function closeResultsPanel() {
        _resultsView.close();
        _closeFindBar();
    }

    // Initialize items dependent on HTML DOM
    AppInit.htmlReady(function () {
        var model = FindInFiles.searchModel;
        _resultsView = new SearchResultsView(model, "find-in-files-results", "find-in-files.results");
        _resultsView
            .on("replaceBatch", function () {
                _finishReplaceBatch(model);
            })
            .on("close", function () {
                FindInFiles.clearSearch();
            })
            .on("getNextPage", function () {
                FindInFiles.getNextPageofSearchResults().done(function () {
                    if (FindInFiles.searchModel.hasResults()) {
                        _resultsView.showNextPage();
                    }
                });
            })
            .on("getLastPage", function () {
                FindInFiles.getAllSearchResults().done(function () {
                    if (FindInFiles.searchModel.hasResults()) {
                        _resultsView.showLastPage();
                    }
                });
            });
    });

    // Initialize: register listeners
    ProjectManager.on("beforeProjectClose", function () { _resultsView.close(); });

    // Initialize: command handlers
    CommandManager.register(Strings.CMD_FIND_IN_FILES,       Commands.CMD_FIND_IN_FILES,       _showFindBar);
    CommandManager.register(Strings.CMD_FIND_IN_SUBTREE,     Commands.CMD_FIND_IN_SUBTREE,     _showFindBarForSubtree);

    CommandManager.register(Strings.CMD_REPLACE_IN_FILES,    Commands.CMD_REPLACE_IN_FILES,    _showReplaceBar);
    CommandManager.register(Strings.CMD_REPLACE_IN_SUBTREE,  Commands.CMD_REPLACE_IN_SUBTREE,  _showReplaceBarForSubtree);

    FindUtils.on(FindUtils.SEARCH_INDEXING_STARTED, _searchIndexingStarted);
    FindUtils.on(FindUtils.SEARCH_INDEXING_PROGRESS, _searchIndexingProgressing);
    FindUtils.on(FindUtils.SEARCH_INDEXING_FINISHED, _searchIndexingFinished);
    FindUtils.on(FindUtils.SEARCH_FILE_FILTERS_CHANGED, _searchIfRequired);
    FindUtils.on(FindUtils.SEARCH_SCOPE_CHANGED, _searchIfRequired);

    // Public exports
    exports.searchAndShowResults = searchAndShowResults;
    exports.searchAndReplaceResults = searchAndReplaceResults;
    exports.closeResultsPanel = closeResultsPanel;

    // For unit testing
    exports._showFindBar  = _showFindBar;
    exports._closeFindBar = _closeFindBar;
});
