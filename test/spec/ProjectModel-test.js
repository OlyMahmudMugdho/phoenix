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

/*global describe, it, expect, beforeEach, awaitsForDone, awaitsForFail, spyOn, jasmine */
/*unittests: ProjectModel */

define(function (require, exports, module) {


    var ProjectModel = require("project/ProjectModel"),
        Immutable = require("thirdparty/immutable");

    describe("ProjectModel", function () {
        describe("shouldShow", function () {
            it("returns true for names that should be shown", function () {
                expect(ProjectModel.shouldShow({
                    name: "test.js"
                })).toBe(true);
            });

            it("returns false for names that should not be shown", function () {
                expect(ProjectModel.shouldShow({
                    name: ".git"
                })).toBe(false);
            });
        });

        describe("_ensureTrailingSlash", function () {
            it("adds a slash when there is none", function () {
                expect(ProjectModel._ensureTrailingSlash("/foo/bar")).toBe("/foo/bar/");
            });

            it("does nothing when there is already a slash", function () {
                expect(ProjectModel._ensureTrailingSlash("/foo/bar/")).toBe("/foo/bar/");
            });
        });

        it("should start with null projectRoot", function () {
            var pm = new ProjectModel.ProjectModel();
            expect(pm.projectRoot).toBe(null);
        });

        describe("with projectRoot", function () {
            var root, pm;

            beforeEach(function () {
                root = {
                    fullPath: "/foo/bar/project/"
                };

                pm = new ProjectModel.ProjectModel({
                    projectRoot: root
                });
            });

            it("allows setting projectRoot on construction", function () {
                expect(pm.projectRoot).toBe(root);
            });

            it("can tell you if a file is in a project", function () {
                var file = {
                    fullPath: "/foo/bar/project/README.md"
                };
                expect(pm.isWithinProject(file)).toBe(true);
            });

            it("can tell you if a file is not in a project", function () {
                var file = {
                    fullPath: "/some/other/project/README.md"
                };
                expect(pm.isWithinProject(file)).toBe(false);
            });

            it("can make a file project relative", function () {
                expect(pm.makeProjectRelativeIfPossible("/foo/bar/project/README.md")).toBe("README.md");
            });

            it("won't create a relative path to a file outside the project", function () {
                expect(pm.makeProjectRelativeIfPossible("/some/other/project/README.md")).toBe("/some/other/project/README.md");
            });

            it("will return a directory within the project", function () {
                expect(pm.getDirectoryInProject("/foo/bar/project/baz/")).toBe("/foo/bar/project/baz/");
                expect(pm.getDirectoryInProject("/foo/bar/project/baz")).toBe("/foo/bar/project/baz/");
                expect(pm.getDirectoryInProject({
                    fullPath: "/foo/bar/project/foo2/",
                    isDirectory: true
                })).toBe("/foo/bar/project/foo2/");
            });

            it("will default to project root when getDirectoryInProject", function () {
                expect(pm.getDirectoryInProject()).toBe("/foo/bar/project/");
                expect(pm.getDirectoryInProject(null)).toBe("/foo/bar/project/");
                expect(pm.getDirectoryInProject("")).toBe("/foo/bar/project/");
                expect(pm.getDirectoryInProject({
                    isFile: true,
                    isDirectory: false,
                    fullPath: "/foo/bar/project/README.txt"
                })).toBe("/foo/bar/project/");
                expect(pm.getDirectoryInProject("/other/project/")).toBe("/foo/bar/project/");
            });
        });

        describe("All Files Cache", function () {
            var visited = false;

            function getPM(filelist, error, rootPath) {
                rootPath = rootPath || "/";
                var root = {
                    fullPath: rootPath,
                    visit: function (visitor, options, errorHandler) {
                        visited = true;
                        if (!filelist && error) {
                            errorHandler(error);
                        } else {
                            filelist.map(visitor);
                        }
                    }
                };
                return new ProjectModel.ProjectModel({
                    projectRoot: root
                });
            }

            beforeEach(function () {
                visited = false;
            });

            it("can create a list of all files", function () {
                var pm = getPM([{
                    fullPath: "/README.md",
                    name: "README.md",
                    isFile: true
                }, {
                    fullPath: "/other/",
                    name: "other",
                    isFile: false
                }, {
                    fullPath: "/other/test.js",
                    name: "test.js",
                    isFile: true
                }]);
                pm.getAllFiles().then(function (allFiles) {
                    expect(allFiles.length).toBe(2);
                    expect(allFiles).toContain("/README.md");
                });
            });

            it("filters files that don't pass shouldShow", function () {
                var pm = getPM([
                    {
                        fullPath: "/setup.pyc",
                        name: "setup.pyc",
                        isFile: true
                    }
                ]);
                pm.getAllFiles().then(function (allFiles) {
                    expect(allFiles.length).toBe(0);
                });
            });

            it("rejects the promise when there's an error", function () {
                var pm = getPM(null, "Got An Error");
                pm.getAllFiles().then(function (allFiles) {
                    expect("should not have gotten here").toBe("because there should be an error");
                }, function (error) {
                    expect(error).toBe("Got An Error");
                });
            });

            it("filters the file list with a function, if desired", function () {
                var pm = getPM([
                    {
                        fullPath: "/README.md",
                        name: "README.md",
                        isFile: true
                    }, {
                        fullPath: "/test.js",
                        name: "test.js",
                        isFile: true
                    }
                ]);

                pm.getAllFiles(function (entry) {
                    return entry.name === "test.js";
                }).then(function (allFiles) {
                    expect(allFiles.length).toBe(1);
                    expect(allFiles).toContain("/test.js");
                });
            });

            it("can add additional non-project files to the list", function () {
                var pm = getPM([
                    {
                        fullPath: "/project/README.md",
                        name: "README.md",
                        isFile: true
                    }
                ], null, "/project");
                pm.getAllFiles([{
                    fullPath: "/project/otherProjectFile.js"
                }, {
                    fullPath: "/RootFile.txt"
                }]).then(function (allFiles) {
                    expect(allFiles.length).toBe(2);
                    expect(allFiles).toContain("/project/README.md");
                    expect(allFiles).toContain("/RootFile.txt");
                });
            });

            it("caches the all files list", function () {
                var pm = getPM([
                    {
                        fullPath: "/project/README.md",
                        name: "README.md",
                        isFile: true
                    }
                ]);
                pm.getAllFiles().then(function (allFiles) {
                    expect(visited).toBe(true);
                    visited = false;
                    pm.getAllFiles().then(function (allFiles) {
                        expect(visited).toBe(false);
                    });
                });
            });

            it("can reset the cache", function () {
                var pm = getPM([
                    {
                        fullPath: "/project/README.md",
                        name: "README.md",
                        isFile: true
                    }
                ]);
                pm.getAllFiles().then(function (allFiles) {
                    expect(visited).toBe(true);
                    visited = false;
                    pm._resetCache();
                    pm.getAllFiles().then(function (allFiles) {
                        expect(visited).toBe(true);
                    });
                });
            });
        });

        describe("_getWelcomeProjectPath", function () {
            it("returns the initial directory if there's no sample URL", function () {
                expect(ProjectModel._getWelcomeProjectPath(undefined, "/Brackets/")).toBe("/Brackets/");
            });

            it("returns the correct sample directory", function () {
                expect(ProjectModel._getWelcomeProjectPath("root/GettingStarted/", "/Brackets/")).toBe(
                    "/Brackets/samples/root/GettingStarted/"
                );
            });

            it("ensures there's a trailing slash for backwards compatibility", function () {
                expect(ProjectModel._getWelcomeProjectPath("root/GettingStarted", "/Brackets/")).toBe(
                    "/Brackets/samples/root/GettingStarted/"
                );
            });
        });

        describe("_addWelcomeProjectPath", function () {
            it("adds the path to a new array", function () {
                var currentProjects = ["GettingStarted"];
                var newProjects = ProjectModel._addWelcomeProjectPath("NewStart/", currentProjects);
                expect(currentProjects.length).toBe(1);
                expect(newProjects).toEqual(["GettingStarted", "NewStart"]);
            });
        });

        describe("_isWelcomeProjectPath", function () {
            it("matches on the current welcome project", function () {
                expect(ProjectModel._isWelcomeProjectPath("/Brackets/GettingStarted/", "/Brackets/GettingStarted/")).toBe(true);
            });

            it("matches on previous welcome projects", function () {
                expect(ProjectModel._isWelcomeProjectPath("/Brackets/GettingStarted/", "/Brackets/NewStart/",
                                                          ["/Brackets/GettingStarted"])).toBe(true);
            });

            it("returns false when there's no match", function () {
                expect(ProjectModel._isWelcomeProjectPath("/Brackets/Unknown/", "/Brackets/NewStart/",
                                                          ["/Brackets/GettingStarted"])).toBe(false);
            });

            it("returns false when the project doesn't match and there are no known projects", function () {
                expect(ProjectModel._isWelcomeProjectPath("/Brackets/Unknown/", "/Brackets/NewStart/")).toBe(false);
            });
        });

        describe("isValidPath", function () {
            it("returns true for UNIX style file path", function () {
                expect(ProjectModel.isValidPath("/tmp/src/test/")).toBe(true);
            });

            it("returns true for WINDOWS style file path", function () {
                expect(ProjectModel.isValidPath("C:\\tmp\\src\\test\\")).toBe(true);
            });

            it("returns false for path that contains an invalid char \'..\'", function () {
                expect(ProjectModel.isValidPath("../tmp/src/test/")).toBe(false);
            });

            it("returns false for path that contains an invalid char \'../..\'", function () {
                expect(ProjectModel.isValidPath("../../tmp/src/test/")).toBe(false);
            });

            it("returns false for path that contains an invalid char \'..\\..\'", function () {
                expect(ProjectModel.isValidPath("..\\..\\tmp\\src\\test\\")).toBe(false);
            });
        });

        describe("isValidFilename", function () {
            it("returns true for simple filename", function () {
                expect(ProjectModel.isValidFilename("foo.txt")).toBe(true);
            });

            it("returns true for filename that starts with a '\.\'", function () {
                expect(ProjectModel.isValidFilename(".tmp")).toBe(true);
            });

            it("returns false for filenames that has ends with a \'.\'", function () {
                expect(ProjectModel.isValidFilename("dummy.")).toBe(false);
            });

            it("returns false for filename that contains an invalid char \'?\'", function () {
                expect(ProjectModel.isValidFilename("foo?txt")).toBe(false);
            });

            it("returns false for filename that contains an invalid char \'*\'", function () {
                expect(ProjectModel.isValidFilename("foo\*txt")).toBe(false);
            });

            it("returns false for filename that contains an invalid char \'\|\'", function () {
                expect(ProjectModel.isValidFilename("foo\|txt")).toBe(false);
            });

            it("returns false for filename that contains an invalid char \'\:\'", function () {
                expect(ProjectModel.isValidFilename("foo\:txt")).toBe(false);
            });

            it("returns false for filename that contains an invalid char \'\<\'", function () {
                expect(ProjectModel.isValidFilename("foo\<txt")).toBe(false);
            });

            it("returns false for filename that contains an invalid char \'\>\'", function () {
                expect(ProjectModel.isValidFilename("foo\>txt")).toBe(false);
            });

            it("returns false for filename that contains an invalid char \'/\'", function () {
                expect(ProjectModel.isValidFilename("directory/foo.txt")).toBe(false);
            });

            it("returns false for filename that contains an invalid char \'//\'", function () {
                expect(ProjectModel.isValidFilename("directory//foo.txt")).toBe(false);
            });

            it("returns false for filename that contains an invalid char \'\\\'", function () {
                expect(ProjectModel.isValidFilename("directory\\foo.txt")).toBe(false);
            });

            it("returns false for filename that contains an invalid char \'\\\\\'", function () {
                expect(ProjectModel.isValidFilename("directory\\\\foo.txt")).toBe(false);
            });

            it("returns false for filename that contains an invalid char \'..\'", function () {
                expect(ProjectModel.isValidFilename("..foo")).toBe(false);
            });

            it("returns false for filename that contains an invalid char \'..\\..\'", function () {
                expect(ProjectModel.isValidFilename("..\\foo")).toBe(false);
            });

            it("returns false for filenames that has invalid name \'com1\'", function () {
                expect(ProjectModel.isValidFilename("com1")).toBe(false);
            });

            it("returns false for filenames that has invalid name \'lpt\'", function () {
                expect(ProjectModel.isValidFilename("lpt1")).toBe(false);
            });

            it("returns false for filenames that has invalid name \'nul\'", function () {
                expect(ProjectModel.isValidFilename("nul")).toBe(false);
            });

            it("returns false for filenames that has invalid name \'con\'", function () {
                expect(ProjectModel.isValidFilename("con")).toBe(false);
            });

            it("returns false for filenames that has invalid name \'prn\'", function () {
                expect(ProjectModel.isValidFilename("prn")).toBe(false);
            });

            it("returns false for filenames that has invalid name \'aux\'", function () {
                expect(ProjectModel.isValidFilename("aux")).toBe(false);
            });

        });

        describe("setProjectRoot", function () {
            var subdir = {
                    fullPath: "/path/to/project/subdir/",
                    name: "subdir",
                    isFile: false
                },
                contents = [
                    {
                        fullPath: "/path/to/project/README.md",
                        name: "README.md",
                        isFile: true
                    },
                    {
                        fullPath: "/path/to/project/afile.js",
                        name: "afile.js",
                        isFile: true
                    },
                    subdir
                ];

            var root = {
                fullPath: "/path/to/project/",
                getContents: function (callback) {
                    setTimeout(function () {
                        callback(null, contents);
                    }, 10);
                }
            };

            it("should initialize the treeData", async function () {
                var model = new ProjectModel.ProjectModel(),
                    vm = model._viewModel;

                var changeFired = false;
                model.on(ProjectModel.EVENT_CHANGE, function () {
                    changeFired = true;
                });

                await awaitsForDone(model.setProjectRoot(root));

                expect(vm._treeData.toJS()).toEqual({
                    "README.md": {},
                    "afile.js": {},
                    "subdir": {
                        children: null
                    }
                });
                expect(changeFired).toBe(true);
            });
        });

        describe("markers", function () {
            var model = new ProjectModel.ProjectModel(),
                vm = model._viewModel,
                changesFired,
                selectionsMade,
                creationErrors,
                focusEvents,
                selectionEvents;

            model.projectRoot = {
                fullPath: "/foo/"
            };

            // temporary
            vm.projectRoot = model.projectRoot;

            model.on(ProjectModel.EVENT_CHANGE, function () {
                changesFired++;
            });

            model.on(ProjectModel.ERROR_CREATION, function (e, error) {
                creationErrors.push(error);
            });

            model.on(ProjectModel.EVENT_SHOULD_FOCUS, function () {
                focusEvents++;
            });

            model.on(ProjectModel.EVENT_SHOULD_SELECT, function (e, data) {
                selectionEvents.push(data);
            });

            beforeEach(function () {
                changesFired = 0;
                focusEvents = 0;
                creationErrors = [];
                selectionsMade = [];
                selectionEvents = [];
                vm._treeData = Immutable.fromJS({
                    subdir1: {
                        open: true,
                        children: {
                            "afile.js": {}
                        }
                    },
                    "afile.js": {},
                    subdir2: {
                        children: null
                    }
                });
                vm._selections = Immutable.Map({
                    selected: null,
                    context: null,
                    rename: null
                });

                model._selections = {};
                model._currentFile = null;
                model._focused = true;
            });

            describe("setSelected", function () {
                it("should select an unselected file", function () {
                    model.setSelected("/foo/afile.js");
                    expect(vm._treeData.getIn(["afile.js", "selected"])).toBe(true);
                    expect(model._selections.selected).toBe("/foo/afile.js");
                    expect(changesFired).toBe(1);
                    expect(selectionEvents).toEqual([{
                        path: "/foo/afile.js",
                        previousPath: undefined,
                        hadFocus: true
                    }]);
                });

                it("should change the selection from the old to the new", function () {
                    model.setSelected("/foo/afile.js");
                    changesFired = 0;
                    selectionEvents = [];
                    model.setSelected("/foo/subdir1/afile.js");
                    expect(vm._treeData.getIn(["afile.js", "selected"])).toBe(undefined);
                    expect(vm._treeData.getIn(["subdir1", "children", "afile.js", "selected"])).toBe(true);
                    expect(changesFired).toBe(1);
                    expect(selectionEvents).toEqual([{
                        path: "/foo/subdir1/afile.js",
                        previousPath: "/foo/afile.js",
                        hadFocus: true
                    }]);
                });

                it("shouldn't fire a changed message if there was no change in selection", function () {
                    model.setSelected("/foo/afile.js");
                    expect(changesFired).toBe(1);
                    changesFired = 0;
                    model.setSelected("/foo/afile.js");
                    expect(changesFired).toBe(0);
                });

                it("should clear the context when there's a new selection", function () {
                    model.setContext("/foo/afile.js");
                    model.setSelected("/foo/subdir1/afile.js");
                    expect(vm._treeData.getIn(["afile.js", "context"])).toBeUndefined();
                    expect(model._selections.context).toBeUndefined();
                });

                it("should be able to restore the context to handle the context menu events", function () {
                    model.setContext("/foo/afile.js");
                    model.setContext(null, false, true);
                    model.restoreContext();
                    expect(model._selections.context).toBe("/foo/afile.js");
                });

                it("can clear the selection by passing in null", function () {
                    model.setSelected("/foo/afile.js");
                    expect(vm._treeData.getIn(["afile.js", "selected"])).toBe(true);
                    changesFired = 0;
                    model.setSelected(null);
                    expect(vm._treeData.getIn(["afile.js", "selected"])).toBeUndefined();
                    expect(changesFired).toBe(1);
                });

                it("won't select a file that is not visible", function () {
                    model.setSelected("/foo/subdir2/bar.js");
                    expect(changesFired).toBe(0);
                    expect(model._selections.selected).toBeNull();
                });

                it("will clear the selected file when selecting one that's not visible", function () {
                    model.setSelected("/foo/subdir1/afile.js");
                    model.setSelected("/foo/subdir2/bar.js");
                    expect(vm._treeData.getIn(["subdir1", "children", "afile.js", "selected"])).toBeUndefined();
                    expect(model._selections.selected).toBeNull();
                });

                it("can accept a filesystem object", function () {
                    model.setSelected({
                        fullPath: "/foo/afile.js"
                    });
                    expect(model._selections.selected).toBe("/foo/afile.js");
                });

                it("does not select directories", function () {
                    model.setSelected("/foo/afile.js");
                    model.setSelected("/foo/subdir1/");
                    expect(model._selections.selected).toBe("/foo/afile.js");
                });
            });

            describe("setFocused", function () {
                it("should clear the selection when the focus leaves the tree", function () {
                    model.setSelected("/foo/afile.js");
                    model.setFocused(false);
                    expect(model._selections.selected).toBe(null);
                    expect(vm._treeData.getIn(["afile.js", "selected"])).toBeUndefined();
                });
            });

            describe("setDirectoryOpen", function () {
                it("will select the current file if it was previously invisible", function () {
                    model.setSelected("/foo/subdir1/afile.js");
                    model.setCurrentFile("/foo/subdir1/afile.js");
                    model.setDirectoryOpen("/foo/subdir1/", false);
                    expect(model._selections.selected).toBe(null);
                    model.setDirectoryOpen("/foo/subdir1/", true);
                    expect(model._selections.selected).toBe("/foo/subdir1/afile.js");
                    expect(focusEvents).toBe(2);
                    expect(vm._treeData.getIn(["subdir1", "children", "afile.js", "selected"])).toBe(true);
                    expect(vm._treeData.getIn(["subdir1", "selected"])).toBeUndefined();
                });

                it("shouldn't clear the selection when closing the directory if the selected file is still visible", function () {
                    vm._treeData = vm._treeData.updateIn(["subdir2", "children"], function () {
                        return Immutable.Map();
                    });
                    model.setSelected("/foo/subdir1/afile.js");
                    model.setCurrentFile("/foo/subdir1/afile.js");
                    model.setDirectoryOpen("/foo/subdir2/", true);
                    expect(model._selections.selected).toBe("/foo/subdir1/afile.js");
                    model.setDirectoryOpen("/foo/subdir2/", false);
                    expect(model._selections.selected).toBe("/foo/subdir1/afile.js");
                });

                it("will load the contents of a closed directory when opened", async function () {
                    spyOn(model, "_getDirectoryContents").and.returnValue(new $.Deferred().resolve([
                        {
                            name: "brackets.js",
                            isFile: true
                        },
                        {
                            name: "src",
                            isFile: false
                        }
                    ]).promise());
                    await awaitsForDone(model.setDirectoryOpen("/foo/subdir2/", true));
                    expect(model._getDirectoryContents).toHaveBeenCalledWith("/foo/subdir2/");
                    expect(vm._treeData.get("subdir2").toJS()).toEqual({
                        open: true,
                        children: {
                            "brackets.js": {},
                            "src": {
                                children: null
                            }
                        }
                    });
                });

                it("shouldn't load a directory that will be closed", async function () {
                    spyOn(model, "_getDirectoryContents").and.returnValue(new $.Deferred().resolve([]).promise());
                    await awaitsForDone(model.setDirectoryOpen("/foo/subdir2", false));
                    expect(vm._treeData.get("subdir2").toJS()).toEqual({
                        children: null
                    });
                });
            });

            describe("setContext", function () {
                it("should set the context flag on a file", function () {
                    model.setContext("/foo/afile.js");
                    expect(vm._treeData.getIn(["afile.js", "context"])).toBe(true);
                    expect(changesFired).toBe(1);
                });

                it("can accept a filesystem object", function () {
                    model.setContext({
                        fullPath: "/foo/afile.js"
                    });
                    expect(model._selections.context).toBe("/foo/afile.js");
                });

                it("should change the context from the old to the new", function () {
                    model.setContext("/foo/afile.js");
                    changesFired = 0;
                    model.setContext("/foo/subdir1/afile.js");
                    expect(vm._treeData.getIn(["afile.js", "context"])).toBe(undefined);
                    expect(vm._treeData.getIn(["subdir1", "children", "afile.js", "context"])).toBe(true);
                    expect(changesFired).toBe(1);
                });

                it("shouldn't fire a changed message if there was no change in context", function () {
                    model.setContext("/foo/afile.js");
                    expect(changesFired).toBe(1);
                    changesFired = 0;
                    model.setContext("/foo/afile.js");
                    expect(changesFired).toBe(0);
                });

                it("can clear the context by passing in null", function () {
                    model.setContext("/foo/afile.js");
                    expect(vm._treeData.getIn(["afile.js", "context"])).toBe(true);
                    changesFired = 0;
                    model.setContext(null);
                    expect(vm._treeData.getIn(["afile.js", "context"])).toBeUndefined();
                    expect(changesFired).toBe(1);
                });
            });

            describe("startRename and friends", function () {
                it("should resolve if there's no path or context", async function () {
                    await awaitsForDone(model.startRename());
                });

                it("should set the rename flag on a file", function () {
                    var promise = model.startRename("/foo/afile.js");
                    expect(vm._treeData.getIn(["afile.js", "rename"])).toBe(true);
                    expect(vm._treeData.getIn(["afile.js", "context"])).toBe(true);
                    expect(model._selections).toEqual({
                        context: "/foo/afile.js",
                        rename: {
                            deferred: jasmine.any(Object),
                            path: "/foo/afile.js",
                            newPath: "/foo/afile.js",
                            type: ProjectModel.FILE_RENAMING
                        }
                    });
                    expect(changesFired).toBe(2);
                    expect(promise.then).toEqual(jasmine.any(Function));
                });

                it("should expand the parent directory if closed", function () {
                    model.setDirectoryOpen("/foo/subdir1", false);
                    expect(vm._treeData.getIn(["subdir1", "open"])).toBeUndefined();
                    model.startRename("/foo/subdir1/afile.js");
                    expect(vm._treeData.getIn(["subdir1", "open"])).toBe(true);
                });

                it("can take a filesystem object or string", function () {
                    model.startRename({
                        fullPath: "/foo/afile.js"
                    });
                    expect(vm._treeData.getIn(["afile.js", "rename"])).toBe(true);
                });

                it("can set a rename value", function () {
                    model.startRename("/foo/afile.js");
                    model.setRenameValue("/foo/bar.js");
                    expect(model._selections.rename.newPath).toBe("/foo/bar.js");
                });

                it("shouldn't fire a changed message or stop the current rename if there was no change in rename", function () {
                    model.startRename("/foo/afile.js");
                    model.setRenameValue("bar.js");
                    changesFired = 0;
                    model.startRename("/foo/afile.js");
                    expect(changesFired).toBe(0);
                });

                it("can clear the rename by calling cancel rename", function () {
                    var promiseValue;
                    model.startRename("/foo/afile.js").then(function (value) {
                        promiseValue = value;
                    });
                    expect(vm._treeData.getIn(["afile.js", "rename"])).toBe(true);
                    expect(vm._treeData.getIn(["afile.js", "context"])).toBe(true);
                    changesFired = 0;
                    model.cancelRename();
                    expect(vm._treeData.getIn(["afile.js", "rename"])).toBeUndefined();
                    expect(model._selections.rename).toBeUndefined();
                    expect(promiseValue).toBe(ProjectModel.RENAME_CANCELLED);
                    expect(changesFired).toBeGreaterThan(0);
                });

                it("clears the rename flag when the context or selection moves", function () {
                    model.startRename("/foo/afile.js");
                    expect(vm._treeData.getIn(["afile.js", "rename"])).toBe(true);
                    model.setSelected("/foo/afile.js");
                    expect(vm._treeData.getIn(["afile.js", "rename"])).toBeUndefined();
                    expect(model._selections.rename).toBeUndefined();
                    model.startRename("/foo/afile.js");
                    expect(vm._treeData.getIn(["afile.js", "rename"])).toBe(true);
                    model.setContext("/foo/subdir1/afile.js");
                    expect(vm._treeData.getIn(["afile.js", "rename"])).toBeUndefined();
                    expect(model._selections.rename).toBeUndefined();
                });

                it("clears the context when rename is cancelled", function () {
                    model.setContext("/foo/afile.js");
                    model.startRename("/foo/afile.js");
                    expect(vm._treeData.getIn(["afile.js", "context"])).toBe(true);
                    model.cancelRename();
                    expect(vm._treeData.getIn(["afile.js", "context"])).toBeUndefined();
                });

                it("doesn't finish the rename when context is cleared", function () {
                    model.startRename("/foo/afile.js");
                    model.setContext(null, true);
                    expect(vm._treeData.getIn(["afile.js", "rename"])).toBe(true);
                    expect(model._selections.rename).toBeDefined();
                });

                it("adjusts the selection if the renamed file was selected", function () {
                    spyOn(model, "_renameItem").and.returnValue(new $.Deferred().resolve().promise());
                    model.setSelected("/foo/afile.js");
                    model.startRename("/foo/afile.js");
                    model.setRenameValue("/foo/something.js");
                    model.performRename();
                    expect(model._selections.selected).toBe("/foo/something.js");
                });

                it("does not adjust the selection if renaming it fails", function () {
                    spyOn(model, "_renameItem").and.returnValue(new $.Deferred().reject().promise());
                    model.setSelected("/foo/afile.js");
                    model.startRename("/foo/afile.js");
                    model.setRenameValue("something.js");
                    model.performRename();
                    expect(model._selections.selected).toBe("/foo/afile.js");
                });

                it("adjusts the selection if a parent folder is renamed", function () {
                    spyOn(model, "_renameItem").and.returnValue(new $.Deferred().resolve().promise());
                    model.setSelected("/foo/afile.js");
                    model.startRename("/foo/");
                    model.setRenameValue("/bar/");
                    model.performRename();
                    expect(model._selections.selected).toBe("/bar/afile.js");
                });

                it("does not adjust the selection if renaming a parent folder fails", function () {
                    spyOn(model, "_renameItem").and.returnValue(new $.Deferred().reject().promise());
                    model.setSelected("/foo/afile.js");
                    model.startRename("/foo/");
                    model.setRenameValue("bar");
                    model.performRename();
                    expect(model._selections.selected).toBe("/foo/afile.js");
                });

                it("does nothing if setRenameValue is called when there's no rename in progress", function () {
                    model.setRenameValue("/foo/bar/baz");
                    expect(model._selections.rename).toBeUndefined();
                });

                it("renames the item immediately in the tree on performRename", function () {
                    spyOn(model, "_renameItem").and.returnValue(new $.Deferred().resolve().promise());
                    model.startRename("/foo/afile.js");
                    model.setRenameValue("bar.js");
                    model.performRename();
                    expect(vm._treeData.get("afile.js")).toBeUndefined();
                    expect(vm._treeData.get("bar.js")).toBeDefined();
                });

                it("can rename a directory", function () {
                    spyOn(model, "_renameItem").and.returnValue(new $.Deferred().resolve().promise());
                    model.startRename("/foo/subdir1/");
                    model.setRenameValue("/foo/somethingelse/");
                    model.performRename();
                    expect(vm._treeData.get("subdir1")).toBeUndefined();
                    expect(vm._treeData.get("somethingelse")).toBeDefined();
                    expect(vm._treeData.getIn(["somethingelse", "open"])).toBe(true);
                    expect(model._renameItem).toHaveBeenCalledWith("/foo/subdir1/", "/foo/somethingelse/", "somethingelse");
                });

                it("fails for invalid filenames", async function () {
                    model.setContext("/foo/afile.js");
                    var promise = model.startRename();
                    model.setRenameValue("com1");
                    model.performRename();
                    promise.fail(function (errorInfo) {
                        expect(errorInfo.type).toBe(ProjectModel.ERROR_INVALID_FILENAME);
                        expect(errorInfo.isFolder).toBe(false);
                        expect(errorInfo.fullPath).toBe("/foo/afile.js");
                    });
                    await awaitsForFail(promise);
                });
            });

            describe("selectInWorkingSet", function () {
                it("should fire event", function () {
                    model.selectInWorkingSet("/foo/afile.js");
                    expect(selectionEvents).toEqual([{
                        path: "/foo/afile.js",
                        add: true
                    }]);
                });
            });

            describe("Item creation", function () {
                it("should open the directory, and create a new node that is marked for creating", function () {
                    model.setDirectoryOpen("/foo/subdir1/", true);
                    changesFired = 0;
                    var promise = model.startCreating("/foo/subdir1/", "Untitled");
                    expect(promise.then).toBeDefined();
                    expect(vm._treeData.getIn(["subdir1", "open"])).toBe(true);
                    expect(vm._treeData.getIn(["subdir1", "children", "Untitled"])).toBeDefined();
                    expect(vm._treeData.getIn(["subdir1", "children", "Untitled", "rename"])).toBe(true);
                    expect(vm._treeData.getIn(["subdir1", "children", "Untitled", "creating"])).toBe(true);
                    expect(model._selections.rename.type).toBe(ProjectModel.FILE_CREATING);
                    expect(model._selections.rename.newPath).toBe("/foo/subdir1/Untitled");
                    expect(changesFired).toBeGreaterThan(0);
                });

                it("should save the item and open it in working set when done creating", function () {
                    spyOn(model, "createAtPath").and.returnValue(new $.Deferred().resolve().promise());
                    model.startCreating("/foo/subdir1/", "Untitled");
                    expect(model._selections.rename.path).toBe("/foo/subdir1/Untitled");
                    expect(model._selections.rename.newPath).toBe("/foo/subdir1/Untitled");
                    changesFired = 0;
                    model.setRenameValue("/foo/subdir1/newfile.js");
                    model.performRename();
                    expect(changesFired).toBeGreaterThan(0);
                    expect(model.createAtPath).toHaveBeenCalledWith("/foo/subdir1/newfile.js");
                    expect(vm._treeData.getIn(["subdir1", "children", "Untitled"])).toBeUndefined();
                    expect(vm._treeData.getIn(["subdir1", "children", "newfile.js"])).toBeDefined();
                    expect(vm._treeData.getIn(["subdir1", "children", "newfile.js", "creating"])).toBeUndefined();
                    expect(vm._treeData.getIn(["subdir1", "children", "newfile.js", "rename"])).toBeUndefined();
                    expect(model._selections.rename).toBeUndefined();

                    // The selectionEvent now comes from createAtPath which we have mocked out.
                    // We can restore this check once we have chosen a way to hook into RequireJS
                    // loading.
//                    expect(selectionEvents).toEqual([{
//                        path: "/foo/subdir1/newfile.js",
//                        add: true
//                    }]);
                });

                it("should create a directory but not open it", function () {
                    spyOn(model, "createAtPath").and.returnValue(new $.Deferred().resolve().promise());
                    model.startCreating("/foo/", "Untitled", true);
                    model.setRenameValue("/foo/newdir/");
                    model.performRename();
                    expect(model.createAtPath).toHaveBeenCalledWith("/foo/newdir/");
                    expect(vm._treeData.getIn(["newdir", "children"]).toJS()).toEqual({});
                    expect(selectionEvents).toEqual([]);
                });

                it("can create an item with the default filename", function () {
                    spyOn(model, "createAtPath").and.returnValue(new $.Deferred().resolve().promise());
                    model.startCreating("/foo/subdir1/", "Untitled");
                    expect(model._selections.rename.path).toBe("/foo/subdir1/Untitled");
                    expect(model._selections.rename.newPath).toBe("/foo/subdir1/Untitled");
                    changesFired = 0;
                    model.performRename();
                    expect(changesFired).toBeGreaterThan(0);
                    expect(model.createAtPath).toHaveBeenCalledWith("/foo/subdir1/Untitled");
                    expect(vm._treeData.getIn(["subdir1", "children", "Untitled"])).toBeDefined();
                    expect(vm._treeData.getIn(["subdir1", "children", "Untitled", "creating"])).toBeUndefined();
                    expect(vm._treeData.getIn(["subdir1", "children", "Untitled", "rename"])).toBeUndefined();
                    expect(model._selections.rename).toBeUndefined();
                });

                it("should do nothing if there is no creation in progress when performRename is called", function () {
                    var treeData = vm._treeData;
                    model.performRename();
                    expect(changesFired).toBe(0);
                    expect(vm._treeData).toBe(treeData);
                });

                it("can cancel creation of a new file", function () {
                    model.startCreating("/foo/subdir1/", "Untitled");
                    changesFired = 0;
                    model.cancelRename();
                    expect(changesFired).toBeGreaterThan(0);
                    expect(vm._treeData.getIn(["subdir1", "children", "Untitled"])).toBeUndefined();
                    expect(model._selections.rename).toBeUndefined();
                    expect(vm.selectionViewInfo.get("hasContext")).toBe(false);
                });

                it("can create files at the root", function () {
                    model.startCreating("/foo/", "Untitled");
                    expect(vm._treeData.getIn(["Untitled", "creating"])).toBe(true);
                });

                it("can create files in a closed directory", function () {
                    spyOn(model, "_getDirectoryContents").and.returnValue(new $.Deferred().resolve([]).promise());
                    model.startCreating("/foo/subdir2/", "Untitled");
                    expect(model._getDirectoryContents).toHaveBeenCalledWith("/foo/subdir2/");
                    expect(vm._treeData.get("subdir2").toJS()).toEqual({
                        open: true,
                        children: {
                            Untitled: {
                                creating: true,
                                rename: true,
                                context: true
                            }
                        }
                    });
                });

                it("can create a directory", function () {
                    spyOn(model, "createAtPath").and.returnValue(new $.Deferred().resolve().promise());
                    model.startCreating("/foo/subdir1/", "Untitled", true);
                    expect(model._selections.rename.path).toBe("/foo/subdir1/Untitled");
                    expect(model._selections.rename.newPath).toBe("/foo/subdir1/Untitled");
                    expect(model._selections.rename.isFolder).toBe(true);
                    changesFired = 0;
                    model.setRenameValue("/foo/subdir1/NewDirectory");
                    model.performRename();
                    expect(changesFired).toBeGreaterThan(0);
                    expect(model.createAtPath).toHaveBeenCalledWith("/foo/subdir1/NewDirectory/");
                    expect(vm._treeData.getIn(["subdir1", "children", "Untitled"])).toBeUndefined();
                    expect(vm._treeData.getIn(["subdir1", "children", "NewDirectory"]).toJS()).toEqual({
                        children: {}
                    });
                    expect(vm._treeData.getIn(["subdir1", "children", "newfile.js", "creating"])).toBeUndefined();
                    expect(vm._treeData.getIn(["subdir1", "children", "newfile.js", "rename"])).toBeUndefined();
                    expect(model._selections.rename).toBeUndefined();
                });

                it("triggers a failure for an invalid filename", async function () {
                    var promise = model.startCreating("/foo/", "Untitled");
                    model.setRenameValue("com1");
                    model.performRename();
                    await awaitsForFail(promise);
                    expect(creationErrors).toEqual([
                        {
                            type: ProjectModel.ERROR_INVALID_FILENAME,
                            name: "com1",
                            isFolder: false
                        }
                    ]);
                    expect(vm._treeData.get("Untitled")).toBeUndefined();
                });
            });
        });

        /**
         * Creates a text fixture with some event trackers that has data that simulates being
         * loaded.
         */
        function getLoadableFixture() {
            var data = {},
                model,
                vm,
                pathData,
                nodesByDepth = [
                    [
                        "/foo/subdir1/",
                        "/foo/subdir3/"
                    ],
                    [
                        "/foo/subdir1/subsubdir/"
                    ]
                ];

            model = new ProjectModel.ProjectModel();
            vm = model._viewModel;
            model.projectRoot = {
                fullPath: "/foo/",
                getContents: function (callback) {
                    return callback(null, [
                        {
                            name: "subdir1",
                            isFile: false
                        },
                        {
                            name: "subdir2",
                            isFile: false
                        },
                        {
                            name: "subdir3",
                            isFile: false
                        },
                        {
                            name: "subdir4",
                            isFile: false
                        }
                    ]);
                }
            };

            pathData = {
                "/foo/subdir1/": [
                    {
                        name: "subsubdir",
                        isFile: false
                    }
                ],
                "/foo/subdir1/subsubdir/": [
                    {
                        name: "interior.txt",
                        isFile: true
                    }
                ],
                "/foo/subdir3/": [
                    {
                        name: "higher.txt",
                        isFile: true
                    }
                ],
                "/foo/subdir4/": [
                    {
                        name: "afile.md",
                        isFile: true
                    },
                    {
                        name: "css",
                        isFile: false
                    },
                    {
                        name: "js",
                        isFile: false
                    },
                    {
                        name: "tmpl",
                        isFile: false
                    }
                ],
                "/foo/subdir4/css/": [
                    {
                        name: "styles.css",
                        isFile: true
                    }
                ],
                "/foo/subdir4/js/": [
                    {
                        name: "code.js",
                        isFile: false
                    }
                ],
                "/foo/subdir4/tmpl/": [
                    {
                        name: "index.hbs",
                        isFile: false
                    }
                ]
            };

            vm._treeData = Immutable.fromJS({
                subdir1: {
                    children: null
                },
                subdir2: {
                    children: null
                },
                subdir3: {
                    children: null
                },
                subdir4: {
                    children: null
                },
                "toplevel.txt": {
                    isFile: true
                }
            });

            data.changesFired = 0;
            model.on(ProjectModel.EVENT_CHANGE, function () {
                data.changesFired++;
            });

            model.on(ProjectModel.EVENT_SHOULD_SELECT, function (e, eventData) {
                data.shouldSelectEvents.push(eventData);
            });

            data.gdcCalls = 0;
            spyOn(model, "_getDirectoryContents").and.callFake(function (path) {
                data.gdcCalls++;
                expect(pathData[path]).toBeDefined();
                return new $.Deferred().resolve(pathData[path]).promise();
            });

            data.model = model;
            data.vm = vm;
            data.shouldSelectEvents = [];
            data.pathData = pathData;
            data.nodesByDepth = nodesByDepth;

            return data;
        }

        describe("_reopenNodes and _refresh", function () {
            var data,
                model,
                vm;


            beforeEach(function () {
                data = getLoadableFixture();
                model = data.model;
                vm = data.vm;
            });

            it("should reopen previously closed nodes", async function () {
                await awaitsForDone(model.reopenNodes(data.nodesByDepth));
                var subdir1 = vm._treeData.get("subdir1");
                expect(subdir1.get("open")).toBe(true);
                expect(subdir1.getIn(["children", "subsubdir", "open"])).toBe(true);
                expect(vm._treeData.getIn(["subdir3", "open"])).toBe(true);
            });

            it("should refresh the whole tree", async function () {
                var oldTree;
                await awaitsForDone(model.reopenNodes(data.nodesByDepth));
                model.setSelected("/foo/subdir1/subsubdir/interior.txt");
                model.setContext("/foo/subdir3/higher.txt");
                data.gdcCalls = 0;
                data.changesFired = 0;
                oldTree = vm._treeData;
                data.pathData["/foo/subdir1/subsubdir/"] = [
                    {
                        name: "newInterior.txt",
                        isFile: true
                    }
                ];
                await awaitsForDone(model.refresh());
                expect(data.changesFired).toBeGreaterThan(0);
                expect(vm._treeData).not.toBe(oldTree);
                expect(vm._treeData.get("subdir1")).toBeDefined();
                expect(vm._treeData.getIn(["subdir1", "children", "subsubdir", "children", "newInterior.txt"])).toBeDefined();
                expect(vm._treeData.getIn(["subdir1", "children", "subsubdir", "children", "interior.txt"])).toBeUndefined();
                expect(vm._treeData.getIn(["subdir3", "children", "higher.txt", "context"])).toBe(true);
            });
        });

        describe("showInTree", function () {
            var data,
                model,
                vm;

            beforeEach(function () {
                data = getLoadableFixture();
                model = data.model;
                vm = data.vm;
            });

            it("should open a closed path via setDirectoryOpen", async function () {
                await awaitsForDone(model.setDirectoryOpen("/foo/subdir1/subsubdir/", true));
                expect(vm._treeData.getIn(["subdir1", "open"])).toBe(true);
                expect(vm._treeData.getIn(["subdir1", "children", "subsubdir", "open"])).toBe(true);
                expect(vm._treeData.getIn(["subdir1", "children", "subsubdir", "children", "interior.txt"])).toBeDefined();
            });

            it("should not have a problem at the root", async function () {
                await awaitsForDone(model.setDirectoryOpen("/foo/"));
                expect(vm._treeData.get("open")).toBeUndefined();
            });

            it("should select a file at the root", async function () {
                await awaitsForDone(model.showInTree("/foo/toplevel.txt"));
                expect(vm._treeData.getIn(["toplevel.txt", "selected"])).toBe(true);
            });

            it("should open a subdirectory", async function () {
                await awaitsForDone(model.showInTree("/foo/subdir1/"));
                expect(vm._treeData.getIn(["subdir1", "open"])).toBe(true);
                expect(vm._treeData.getIn(["subdir1", "children", "subsubdir"])).toBeDefined();
                expect(model._selections.selected).toBeNull();
            });

            it("should open a subdirectory and select a file", async function () {
                model.setFocused(false);
                await awaitsForDone(model.showInTree("/foo/subdir1/subsubdir/interior.txt"));
                expect(vm._treeData.getIn(["subdir1", "open"])).toBe(true);
                expect(vm._treeData.getIn(["subdir1", "children", "subsubdir", "open"])).toBe(true);
                expect(vm._treeData.getIn(["subdir1", "children", "subsubdir", "children", "interior.txt", "selected"])).toBe(true);
                expect(data.shouldSelectEvents[0].path).toEqual("/foo/subdir1/subsubdir/interior.txt");
            });
        });

        describe("toggleSubdirectories", function () {
            var data,
                model,
                vm;

            beforeEach(function () {
                data = getLoadableFixture();
                model = data.model;
                vm = data.vm;
            });

            it("should open all of the sibling directories", async function () {
                await awaitsForDone(model.setDirectoryOpen("/foo/subdir4/", true));
                await awaitsForDone(model.toggleSubdirectories("/foo/subdir4/", true));

                expect(vm.treeData.getIn(["subdir4", "children", "css", "open"])).toBe(true);
                expect(vm.treeData.getIn(["subdir4", "children", "js", "open"])).toBe(true);
            });

            it("should close all of the sibling directories", async function () {
                await awaitsForDone(model.setDirectoryOpen("/foo/subdir4/", true));
                await awaitsForDone(model.toggleSubdirectories("/foo/subdir4/", true));
                await awaitsForDone(model.toggleSubdirectories("/foo/subdir4/", false));
                expect(vm.treeData.getIn(["subdir4", "children", "css", "open"])).toBeUndefined();
                expect(vm.treeData.getIn(["subdir4", "children", "js", "open"])).toBeUndefined();
            });
        });

        describe("closeSubtree", function () {
            var data,
                model,
                vm;

            beforeEach(function () {
                data = getLoadableFixture();
                model = data.model;
                vm = data.vm;
            });

            it("should close the directory and its children", async function () {
                await awaitsForDone(model.setDirectoryOpen("/foo/subdir4/", true));
                await awaitsForDone(model.toggleSubdirectories("/foo/subdir4/", true));
                model.closeSubtree("/foo/subdir4/");
                expect(vm._getObject("subdir4/js").get("open")).toBeUndefined();
            });
        });

        describe("handleFSEvent", function () {
            var model = new ProjectModel.ProjectModel(),
                vm = model._viewModel;

            beforeEach(function () {
                model.projectRoot = {
                    fullPath: "/foo/"
                };

                vm._treeData = Immutable.fromJS({
                    "topfile.js": {},
                    subdir: {
                        children: {
                            "subfile.md": {}
                        }
                    }
                });
            });

            it("should register a change to a root file", function () {
                model.handleFSEvent({
                    isFile: true,
                    name: "topfile.js",
                    fullPath: "/foo/topfile.js"
                });
                expect(vm._treeData.getIn(["topfile.js", "_timestamp"])).toBeGreaterThan(0);
            });

            it("should reset the cache of files when a file is added or removed", function () {
                spyOn(model, "_resetCache");
                model.handleFSEvent({
                    isFile: false,
                    name: "foo",
                    fullPath: "/foo/"
                }, [{
                    name: "newfile.js",
                    isFile: true,
                    fullPath: "/foo/newfile.js"
                }]);

                expect(model._resetCache).toHaveBeenCalled();
            });

            it("should handle new files and directories", function () {
                model.handleFSEvent({
                    isFile: false,
                    name: "foo",
                    fullPath: "/foo/"
                }, [{
                    name: "newfile.js",
                    fullPath: "/foo/newfile.js",
                    isFile: true
                }, {
                    name: "newdir",
                    fullPath: "/foo/subdir/newdir/",
                    isFile: false
                }]);

                expect(vm._treeData.get("newfile.js").toJS()).toEqual({});
                expect(vm._treeData.getIn(["subdir", "children", "newdir", "children"])).toBeNull();
            });

            it("should handle removed files and directories", function () {
                model.handleFSEvent({
                    isFile: false,
                    name: "foo",
                    fullPath: "/foo/"
                }, null, [{
                    name: "topfile.js",
                    fullPath: "/foo/topfile.js",
                    isFile: true
                }, {
                    name: "subdir",
                    fullPath: "/foo/subdir/",
                    isFile: false
                }]);

                expect(vm._treeData.get("topfile.js")).toBeUndefined();
                expect(vm._treeData.get("subdir")).toBeUndefined();
            });

            it("should refresh if no entry is given", function () {
                spyOn(model, "refresh");
                model.handleFSEvent();
                expect(model.refresh).toHaveBeenCalled();
            });

            it("should do nothing if the entry is outside of the current project", function () {
                spyOn(vm, "processChanges");
                model.handleFSEvent({
                    isFile: true,
                    fullPath: "/bar/baz.js",
                    name: "baz.js"
                });
                expect(vm.processChanges).not.toHaveBeenCalled();
            });

            it("should unselect a file if it's deleted", function () {
                model.setSelected("/foo/topfile.js");
                model.handleFSEvent({
                    isFile: false,
                    name: "foo",
                    fullPath: "/foo/"
                }, null, [{
                    name: "topfile.js",
                    fullPath: "/foo/topfile.js",
                    isFile: true
                }]);
                expect(model._selections.selected).toBeNull();
            });

            it("should cancel renaming a deleted file", function () {
                model.startRename("/foo/topfile.js");
                model.handleFSEvent({
                    isFile: false,
                    name: "foo",
                    fullPath: "/foo/"
                }, null, [{
                    name: "topfile.js",
                    fullPath: "/foo/topfile.js",
                    isFile: true
                }]);
                expect(model._selections.rename).toBeUndefined();
            });

            it("should remove context from a deleted file", function () {
                model.setContext("/foo/topfile.js");
                model.handleFSEvent({
                    isFile: false,
                    name: "foo",
                    fullPath: "/foo/"
                }, null, [{
                    name: "topfile.js",
                    fullPath: "/foo/topfile.js",
                    isFile: true
                }]);
                expect(model._selections.context).toBeNull();
            });

            it("should see events with a directory but no added or removed as a need to reload the directory", function () {
                model.handleFSEvent({
                    isFile: false,
                    name: "newdir",
                    fullPath: "/foo/newdir/",
                    getContents: function (callback) {
                        callback(null, [
                            {
                                isFile: true,
                                name: "newfile",
                                fullPath: "/foo/newdir/newfile"
                            }
                        ]);
                    }
                });
                expect(vm._treeData.get("newdir").toJS()).toEqual({
                    children: {
                        newfile: {}
                    }
                });
            });
        });
    });
});
